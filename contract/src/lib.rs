//! Owl Toons: an AI cartoon studio that runs itself on NEAR.
//!
//! Fans pay to pitch and vote on the next plot. When the vote closes the agent
//! writes and draws the winning episode, mints it here as an NFT to the fan whose
//! plot won, and the round's pot is paid out by fixed rules:
//!   50% to the fans who voted for the winning plot (by how much each voted)
//!   12% / 5% / 3% to whoever pitched the 1st / 2nd / 3rd placed plots
//!   20% to the HOODL treasury (buyback & burn), 10% to the agent's AI budget.
//! Every tip on an episode is split on the spot: 60% to the episode NFT owner,
//! 25% to the treasury, 15% to the agent's AI budget.
//! Fans collect their winnings with claim().

use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const VOTE_MIN: u128 = ONE_NEAR / 10; // 0.1 NEAR
const PITCH_FEE: u128 = ONE_NEAR; // 1 NEAR
const MAX_OPTIONS: usize = 6;
const MAX_PITCH_LEN: usize = 120;
const MAX_BACKERS: usize = 300;
// tip split in basis points: 60% NFT owner, 25% treasury, 15% AI budget
const TIP_OWNER_BPS: u128 = 6_000;
const TIP_TREASURY_BPS: u128 = 2_500;
// round pot split at publish time
const POT_VOTERS_BPS: u128 = 5_000; // backers of the winning plot, pro rata
const POT_PLACES_BPS: [u128; 3] = [1_200, 500, 300]; // pitchers of 1st, 2nd, 3rd
const POT_TREASURY_BPS: u128 = 2_000; // the rest (1_000) goes to the AI budget

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    NonFungibleToken,
    Metadata,
    TokenMetadata,
    Enumeration,
    Approval,
    Episodes,
    Earnings,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PlotOption {
    pub text: String,
    /// who pitched it; the agent's own suggestions are pitched by the contract owner
    pub by: AccountId,
    /// total NEAR voted on this option, in yocto
    pub votes: U128,
    pub voters: u32,
    /// who voted for this plot and how much (yocto)
    pub backers: Vec<(AccountId, U128)>,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Round {
    /// the episode number this vote decides
    pub episode: u32,
    pub options: Vec<PlotOption>,
    /// unix ms; votes after this are refused
    pub closes_at: u64,
    /// votes + pitch fees collected this round, in yocto
    pub pot: U128,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Episode {
    pub number: u32,
    pub title: String,
    pub plot: String,
    pub plot_by: AccountId,
    pub tips: U128,
    pub tippers: u32,
    pub published_at: u64,
    /// what the round paid out: [winning voters, 1st, 2nd, 3rd pitchers, treasury, AI budget]
    pub payouts: Vec<U128>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Stats {
    pub agent: AccountId,
    pub treasury: AccountId,
    pub episodes: u32,
    /// everything fans ever paid in (votes, pitches, tips)
    pub earned: U128,
    /// sent to the HOODL treasury for buyback & burn
    pub to_treasury: U128,
    /// paid to fans (winning voters, top pitchers, episode owners)
    pub to_fans: U128,
    /// waiting in the compute reserve
    pub reserve: U128,
    /// withdrawn by the agent to pay its AI bills
    pub spent_on_ai: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct OwlToons {
    agent: AccountId,
    treasury: AccountId,
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    round: Round,
    episodes: Vector<Episode>,
    earnings: LookupMap<AccountId, u128>,
    earned: u128,
    to_treasury: u128,
    to_fans: u128,
    reserve: u128,
    spent_on_ai: u128,
}

#[near]
impl OwlToons {
    #[init]
    pub fn new(agent: AccountId, treasury: AccountId) -> Self {
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Owl Toons".to_string(),
            symbol: "TOON".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        Self {
            agent: agent.clone(),
            treasury,
            tokens: NonFungibleToken::new(
                StorageKey::NonFungibleToken,
                env::current_account_id(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            round: Round { episode: 1, options: vec![], closes_at: 0, pot: U128(0) },
            episodes: Vector::new(StorageKey::Episodes),
            earnings: LookupMap::new(StorageKey::Earnings),
            earned: 0,
            to_treasury: 0,
            to_fans: 0,
            reserve: 0,
            spent_on_ai: 0,
        }
    }

    // ---------- fans ----------

    /// Pitch your own plot for the next episode. Costs 1 NEAR. If it wins, you get the episode NFT.
    #[payable]
    pub fn pitch(&mut self, text: String) -> u32 {
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= PITCH_FEE, "Pitching a plot costs 1 NEAR");
        self.require_open();
        let text = text.trim().to_string();
        require!(!text.is_empty() && text.len() <= MAX_PITCH_LEN, "Plot must be 1 to 120 characters");
        require!(self.round.options.len() < MAX_OPTIONS, "This round is full, vote on an existing plot");
        self.round.options.push(PlotOption { text, by: env::predecessor_account_id(), votes: U128(0), voters: 0, backers: vec![] });
        self.add_to_pot(paid);
        (self.round.options.len() - 1) as u32
    }

    /// Vote for a plot with at least 0.1 NEAR. More NEAR = more weight.
    #[payable]
    pub fn vote(&mut self, option: u32) {
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= VOTE_MIN, "A vote costs at least 0.1 NEAR");
        self.require_open();
        let who = env::predecessor_account_id();
        let o = self.round.options.get_mut(option as usize).unwrap_or_else(|| env::panic_str("No such plot"));
        o.votes = U128(o.votes.0 + paid);
        if let Some(b) = o.backers.iter_mut().find(|b| b.0 == who) {
            b.1 = U128(b.1 .0 + paid);
        } else {
            require!(o.backers.len() < MAX_BACKERS, "This plot has too many voters already");
            o.backers.push((who, U128(paid)));
            o.voters += 1;
        }
        self.add_to_pot(paid);
    }

    /// Tip an episode. Split on chain: 60% to the NFT owner, 25% to the treasury, 15% to the AI budget.
    #[payable]
    pub fn tip(&mut self, episode: u32) -> Promise {
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= ONE_NEAR / 100, "Minimum tip is 0.01 NEAR");
        require!(episode >= 1 && episode <= self.episodes.len(), "No such episode");
        let owner = self.tokens.owner_by_id.get(&episode.to_string()).unwrap_or_else(|| self.agent.clone());
        let to_owner = paid * TIP_OWNER_BPS / 10_000;
        let to_treasury = paid * TIP_TREASURY_BPS / 10_000;
        let to_reserve = paid - to_owner - to_treasury;
        let ep = self.episodes.get_mut(episode - 1).unwrap();
        ep.tips = U128(ep.tips.0 + paid);
        ep.tippers += 1;
        self.earned += paid;
        self.to_fans += to_owner;
        self.to_treasury += to_treasury;
        self.reserve += to_reserve;
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"owltoons\",\"version\":\"1.0.0\",\"event\":\"tip\",\"data\":[{{\"episode\":{},\"from\":\"{}\",\"amount\":\"{}\",\"owner\":\"{}\"}}]}}",
            episode, env::predecessor_account_id(), paid, owner
        ));
        Promise::new(owner)
            .transfer(NearToken::from_yoctonear(to_owner))
            .and(Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(to_treasury)))
    }

    // ---------- the agent ----------

    /// Open the vote for the next episode with the agent's own plot ideas.
    pub fn open_round(&mut self, ideas: Vec<String>, closes_at: u64) {
        self.require_agent();
        require!(ideas.len() <= MAX_OPTIONS, "Too many ideas");
        require!(self.round.options.is_empty() || self.round.episode > self.episodes.len(), "Publish the current episode first");
        let options = ideas
            .into_iter()
            .map(|t| t.trim().chars().take(MAX_PITCH_LEN).collect::<String>())
            .filter(|t| !t.is_empty())
            .map(|text| PlotOption { text, by: self.agent.clone(), votes: U128(0), voters: 0, backers: vec![] })
            .collect();
        let pot = self.round.pot;
        self.round = Round { episode: self.episodes.len() + 1, options, closes_at, pot };
    }

    /// Publish the winning episode: mint it to the plot's author and pay out the round pot.
    /// Returns the winning option index.
    pub fn publish_episode(&mut self, title: String, media: String, script: String) -> u32 {
        self.require_agent();
        require!(env::block_timestamp_ms() >= self.round.closes_at, "The vote is still open");
        require!(!self.round.options.is_empty(), "Nothing to publish");
        // rank plots by NEAR voted (ties: the earlier plot wins)
        let mut order: Vec<usize> = (0..self.round.options.len()).collect();
        order.sort_by(|a, b| self.round.options[*b].votes.0.cmp(&self.round.options[*a].votes.0).then(a.cmp(b)));
        let win = order[0];
        let w = self.round.options[win].clone();
        let number = self.episodes.len() + 1;
        let token_id: TokenId = number.to_string();
        let meta = TokenMetadata {
            title: Some(format!("Owl Toons #{}: {}", number, title)),
            description: Some(format!("Plot: {} (pitched by {}). Written and drawn by the Owl Toons agent.", w.text, w.by)),
            media: Some(media),
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(script.chars().take(4_000).collect()),
            reference: None,
            reference_hash: None,
        };
        self.tokens.internal_mint_with_refund(token_id, w.by.clone(), Some(meta), None);
        // pay out the pot
        let pot = self.round.pot.0;
        let mut to_treasury = pot * POT_TREASURY_BPS / 10_000;
        let mut paid_out = 0u128;
        // 1) backers of the winning plot, by how much each voted
        let voters_share = pot * POT_VOTERS_BPS / 10_000;
        let mut to_voters = 0u128;
        if w.votes.0 > 0 {
            for (who, amt) in w.backers.iter() {
                let cut = voters_share * (amt.0 * 1_000_000_000 / w.votes.0) / 1_000_000_000; // 9-digit share, no overflow
                if cut > 0 {
                    self.credit(who, cut);
                    to_voters += cut;
                }
            }
        }
        to_treasury += voters_share - to_voters; // nobody backed the winner: their share burns
        paid_out += to_voters;
        // 2) the fans who pitched the top 3 plots (the agent's own ideas earn nothing: that share burns)
        let mut places = [0u128; 3];
        for (rank, idx) in order.iter().take(3).enumerate() {
            let o = &self.round.options[*idx];
            let cut = pot * POT_PLACES_BPS[rank] / 10_000;
            if o.by != self.agent && o.votes.0 > 0 {
                let by = o.by.clone();
                self.credit(&by, cut);
                places[rank] = cut;
                paid_out += cut;
            } else {
                to_treasury += cut;
            }
        }
        for rank in order.len()..3 {
            to_treasury += pot * POT_PLACES_BPS[rank] / 10_000;
        }
        let to_reserve = pot - paid_out - to_treasury;
        self.to_fans += paid_out;
        self.to_treasury += to_treasury;
        self.reserve += to_reserve;
        self.episodes.push(Episode {
            number,
            title,
            plot: w.text.clone(),
            plot_by: w.by.clone(),
            tips: U128(0),
            tippers: 0,
            published_at: env::block_timestamp_ms(),
            payouts: vec![U128(to_voters), U128(places[0]), U128(places[1]), U128(places[2]), U128(to_treasury), U128(to_reserve)],
        });
        self.round = Round { episode: number + 1, options: vec![], closes_at: 0, pot: U128(0) };
        if to_treasury > 0 {
            Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(to_treasury)).detach();
        }
        win as u32
    }

    /// Collect everything you have won (from voting on winning plots and pitching top-3 plots).
    pub fn claim(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amt = self.earnings.remove(&who).unwrap_or(0);
        require!(amt > 0, "Nothing to claim yet");
        Promise::new(who).transfer(NearToken::from_yoctonear(amt))
    }

    pub fn get_earnings(&self, account_id: AccountId) -> U128 {
        U128(*self.earnings.get(&account_id).unwrap_or(&0))
    }

    /// The agent pays its own AI bill out of the compute reserve. Logged on chain.
    pub fn pay_compute(&mut self, amount: U128, note: String) -> Promise {
        self.require_agent();
        require!(amount.0 <= self.reserve, "Not enough in the compute reserve");
        self.reserve -= amount.0;
        self.spent_on_ai += amount.0;
        env::log_str(&format!("compute: {} yocto for {}", amount.0, note.chars().take(80).collect::<String>()));
        Promise::new(self.agent.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ---------- views ----------

    pub fn get_round(&self) -> Round {
        self.round.clone()
    }

    pub fn get_stats(&self) -> Stats {
        Stats {
            agent: self.agent.clone(),
            treasury: self.treasury.clone(),
            episodes: self.episodes.len(),
            earned: U128(self.earned),
            to_treasury: U128(self.to_treasury),
            to_fans: U128(self.to_fans),
            reserve: U128(self.reserve),
            spent_on_ai: U128(self.spent_on_ai),
        }
    }

    pub fn get_episodes(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Episode> {
        let n = self.episodes.len();
        let limit = limit.unwrap_or(20).min(50);
        let start = from.unwrap_or(if n > limit { n - limit } else { 0 });
        (start..n.min(start + limit)).filter_map(|i| self.episodes.get(i).cloned()).collect()
    }

    // ---------- internals ----------

    fn require_agent(&self) {
        require!(env::predecessor_account_id() == self.agent, "Only the Owl Toons agent can do this");
    }

    fn require_open(&self) {
        require!(!self.round.options.is_empty() || self.round.closes_at > 0, "No vote is open right now");
        require!(env::block_timestamp_ms() < self.round.closes_at, "The vote for this episode has closed");
    }

    fn credit(&mut self, who: &AccountId, amount: u128) {
        let cur = *self.earnings.get(who).unwrap_or(&0);
        self.earnings.insert(who.clone(), cur + amount);
    }

    fn add_to_pot(&mut self, amount: u128) {
        self.round.pot = U128(self.round.pot.0 + amount);
        self.earned += amount;
    }
}

// ---------- NEP-171 NFT standard ----------

#[near]
impl NonFungibleTokenCore for OwlToons {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for OwlToons {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }
    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for OwlToons {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(who: AccountId, deposit: u128, ms: u64) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(who)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ms * 1_000_000)
            .storage_usage(1_000);
        testing_env!(b.build());
    }

    #[test]
    fn full_round() {
        let agent = accounts(0);
        let treasury = accounts(1);
        let fan = accounts(2);
        ctx(agent.clone(), 0, 1_000);
        let mut c = OwlToons::new(agent.clone(), treasury);
        c.open_round(vec!["the owl meets a fox".into(), "the owl goes to the moon".into()], 10_000);
        ctx(fan.clone(), PITCH_FEE, 2_000);
        let i = c.pitch("a whale sleeps on the branch".into());
        assert_eq!(i, 2);
        ctx(fan.clone(), ONE_NEAR / 2, 3_000);
        c.vote(2);
        ctx(accounts(3), VOTE_MIN, 3_500);
        c.vote(0);
        ctx(agent.clone(), 0, 11_000);
        let win = c.publish_episode("Big sleep".into(), "https://justhoodl.fun/api/toons?ep=1".into(), "{}".into());
        assert_eq!(win, 2);
        assert_eq!(c.nft_token("1".into()).unwrap().owner_id, fan);
        let s = c.get_stats();
        assert_eq!(s.episodes, 1);
        let pot = PITCH_FEE + ONE_NEAR / 2 + VOTE_MIN;
        // fan backed the winner alone (50%) and pitched the 1st placed plot (12%)
        assert_eq!(c.get_earnings(fan.clone()).0, pot / 2 + pot * 12 / 100);
        // 2nd place was the agent's own idea, 3rd had no votes: those shares + 20% go to the treasury
        assert_eq!(s.to_treasury.0, pot * 20 / 100 + pot * 5 / 100 + pot * 3 / 100);
        assert_eq!(s.reserve.0, pot - (pot / 2 + pot * 12 / 100) - s.to_treasury.0);
        ctx(accounts(4), ONE_NEAR, 12_000);
        let _ = c.tip(1);
        let s = c.get_stats();
        assert_eq!(s.to_fans.0, pot / 2 + pot * 12 / 100 + ONE_NEAR * 6 / 10);
        ctx(fan.clone(), 0, 13_000);
        let _ = c.claim();
        assert_eq!(c.get_earnings(fan).0, 0);
    }

    #[test]
    fn voters_split_by_weight() {
        let agent = accounts(0);
        ctx(agent.clone(), 0, 1_000);
        let mut c = OwlToons::new(agent.clone(), accounts(1));
        c.open_round(vec!["a".into(), "b".into()], 10_000);
        ctx(accounts(2), ONE_NEAR * 3, 2_000);
        c.vote(0);
        ctx(accounts(3), ONE_NEAR, 2_100);
        c.vote(0);
        ctx(accounts(4), ONE_NEAR, 2_200);
        c.vote(1);
        ctx(accounts(3), ONE_NEAR, 2_300);
        c.vote(0);
        ctx(agent.clone(), 0, 11_000);
        c.publish_episode("t".into(), "m".into(), "{}".into());
        let pot = ONE_NEAR * 6;
        // winner a had 5 NEAR: accounts(2) 3, accounts(3) 2
        assert_eq!(c.get_earnings(accounts(2)).0, pot / 2 * 3 / 5);
        assert_eq!(c.get_earnings(accounts(3)).0, pot / 2 * 2 / 5);
        assert_eq!(c.get_earnings(accounts(4)).0, 0);
        assert_eq!(c.get_round().options.len(), 0);
    }

    #[test]
    #[should_panic(expected = "The vote for this episode has closed")]
    fn late_vote() {
        let agent = accounts(0);
        ctx(agent.clone(), 0, 1_000);
        let mut c = OwlToons::new(agent, accounts(1));
        c.open_round(vec!["x".into()], 5_000);
        ctx(accounts(2), VOTE_MIN, 6_000);
        c.vote(0);
    }
}
