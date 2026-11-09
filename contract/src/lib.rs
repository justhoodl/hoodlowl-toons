//! Owl Toons: an AI cartoon studio that runs itself on NEAR.
//!
//! Fans pay to pitch and vote on tomorrow's plot. Every night the agent (the
//! contract owner) writes and draws the winning episode, mints it here as an NFT
//! to the fan whose plot won, and opens the next vote. Every tip on an episode is
//! split on chain: 50% to whoever owns the episode NFT, 30% to the HOODL treasury
//! (buyback & burn), 20% to the agent's compute reserve that pays for its AI.

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
use near_sdk::store::Vector;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const VOTE_MIN: u128 = ONE_NEAR / 10; // 0.1 NEAR
const PITCH_FEE: u128 = ONE_NEAR; // 1 NEAR
const MAX_OPTIONS: usize = 6;
const MAX_PITCH_LEN: usize = 120;
// tip split in basis points
const TIP_OWNER_BPS: u128 = 5_000;
const TIP_TREASURY_BPS: u128 = 3_000;
// round pot split (votes + pitch fees) at publish time
const POT_TREASURY_BPS: u128 = 7_000;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    NonFungibleToken,
    Metadata,
    TokenMetadata,
    Enumeration,
    Approval,
    Episodes,
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
    /// paid to plot winners / episode owners
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
        self.round.options.push(PlotOption { text, by: env::predecessor_account_id(), votes: U128(0), voters: 0 });
        self.add_to_pot(paid);
        (self.round.options.len() - 1) as u32
    }

    /// Vote for a plot with at least 0.1 NEAR. More NEAR = more weight.
    #[payable]
    pub fn vote(&mut self, option: u32) {
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= VOTE_MIN, "A vote costs at least 0.1 NEAR");
        self.require_open();
        let o = self.round.options.get_mut(option as usize).unwrap_or_else(|| env::panic_str("No such plot"));
        o.votes = U128(o.votes.0 + paid);
        o.voters += 1;
        self.add_to_pot(paid);
    }

    /// Tip an episode. Split on chain: 50% to the NFT owner, 30% to the treasury, 20% to the compute reserve.
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
            .map(|text| PlotOption { text, by: self.agent.clone(), votes: U128(0), voters: 0 })
            .collect();
        let pot = self.round.pot;
        self.round = Round { episode: self.episodes.len() + 1, options, closes_at, pot };
    }

    /// Publish the winning episode: mint it to the plot's author and settle the round pot
    /// (70% treasury, 30% compute reserve). Returns the winning option index.
    pub fn publish_episode(&mut self, title: String, media: String, script: String) -> u32 {
        self.require_agent();
        require!(env::block_timestamp_ms() >= self.round.closes_at, "The vote is still open");
        require!(!self.round.options.is_empty(), "Nothing to publish");
        let mut win = 0usize;
        for (i, o) in self.round.options.iter().enumerate() {
            if o.votes.0 > self.round.options[win].votes.0 {
                win = i;
            }
        }
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
        self.episodes.push(Episode {
            number,
            title,
            plot: w.text.clone(),
            plot_by: w.by.clone(),
            tips: U128(0),
            tippers: 0,
            published_at: env::block_timestamp_ms(),
        });
        // settle the pot
        let pot = self.round.pot.0;
        let to_treasury = pot * POT_TREASURY_BPS / 10_000;
        self.to_treasury += to_treasury;
        self.reserve += pot - to_treasury;
        self.round = Round { episode: number + 1, options: vec![], closes_at: 0, pot: U128(0) };
        if to_treasury > 0 {
            Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(to_treasury)).detach();
        }
        win as u32
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
        assert_eq!(s.to_treasury.0, pot * 7 / 10);
        ctx(accounts(4), ONE_NEAR, 12_000);
        let _ = c.tip(1);
        let s = c.get_stats();
        assert_eq!(s.to_fans.0, ONE_NEAR / 2);
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
