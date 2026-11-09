# Owl Toons

**An AI cartoon studio that runs itself on NEAR.**
Fans write the story, the AI makes the cartoon, the cartoon pays its fans and burns $HOODL.

Live: **https://justhoodl.fun/toons/** (NEAR testnet)
Contract: [`owltoons-hoodl.testnet`](https://testnet.nearblocks.io/address/owltoons-hoodl.testnet) · Agent: [`owltoons-agent.testnet`](https://testnet.nearblocks.io/address/owltoons-agent.testnet)

Built for the NEAR Hackathon by the $HOODL community. Tracks: **Autonomous Business**, **Agent Economy**, **NFTs That Do Something**.

---

## What it does

1. **Fans vote.** Every round, the agent pitches 3 plots for the next episode. Anyone can vote with NEAR (0.1 NEAR or more, more NEAR = more weight) or pitch their own plot for 1 NEAR.
2. **The AI writes.** When the vote closes, the agent asks **NEAR AI Cloud** to write a 4-panel comic script from the winning plot.
3. **The art kit draws.** The script picks characters, poses, scenes, props and dialogue from a hand-drawn HOODL art kit (the owl, a scammer fox, a whale, a paper-hands frog, 6 scenes, 6 props). The comic is drawn as an SVG, so every episode looks hand-made and consistent, not like a random AI image.
4. **The episode becomes an NFT** (NEP-171), minted on chain **to the fan whose plot won**.
5. **Every tip is split on chain, instantly:** 50% to whoever owns the episode NFT, 30% to the HOODL treasury (buyback and burn), 20% to the agent's compute reserve.
6. **The agent runs the business on its own.** It signs its own NEAR transactions with its own key. It pays its own AI bill out of the compute reserve (`pay_compute`, logged on chain), sends 70% of every vote pot to the treasury, and opens the next vote. Nobody presses a button.

Because the plot winner owns the NFT, owning an episode is owning a small income stream: sell the NFT and the tip share moves with it.

## How to try it (free)

1. Get a testnet wallet: [testnet.mynearwallet.com](https://testnet.mynearwallet.com) or Meteor Wallet switched to testnet (both give you free test NEAR).
2. Open https://justhoodl.fun/toons/ and tap **Connect wallet**.
3. Vote on a plot, or pitch your own.
4. When the timer runs out, the agent makes the episode by itself (it checks every 10 minutes). Tip it, or find your NFT in your wallet if your plot won.

The vote, the agent's wallet numbers and the episode list come straight from the contract (`get_round`, `get_stats`, `get_episodes`).

## Architecture

```
 fans (NEAR wallet) ──vote / pitch / tip──►  owltoons-hoodl.testnet  (Rust contract, this repo /contract)
                                               │  rounds, votes, pot, episodes, NEP-171 NFTs,
                                               │  tip split, treasury payouts, compute reserve
                                               ▲
 Vercel cron (every 10 min) ──► agent (/agent/toons.js)
     1. read get_round; vote closed?
     2. NEAR AI Cloud (deepseek-v3.2) writes the 4-panel script as JSON
     3. art kit (/agent/_toons_art.js) draws the SVG comic
     4. publish_episode  → NFT minted to the plot winner, pot settled (70% treasury / 30% reserve)
     5. pay_compute      → agent pays its AI bill from the reserve
     6. NEAR AI pitches 3 new plots → open_round
```

- **contract/** Rust, `near-sdk` 5. Unit tests cover a full round (ideas, a fan pitch, votes, publish, NFT to the winner, pot split, tip split) and late votes.
- **res/owl_toons.wasm** compiled in public by GitHub Actions (`.github/workflows/build-contract.yml`) on every change, with its sha256. The deployed code can be checked against it.
- **agent/toons.js** the agent: NEAR transaction signing (ed25519 + borsh, no SDK), NEAR AI calls, the studio loop, a JSON API for the site, and the episode images (`/api/toons?ep=N` is each NFT's media).
- **agent/_toons_art.js** the art kit: every character, scene, prop and speech bubble.
- **web/index.html** the site: vote, pitch, tip, watch the agent's wallet and log.

## Contract methods

| Who | Method | What it does |
|---|---|---|
| fans | `vote(option)` payable, ≥ 0.1 NEAR | adds weight to a plot |
| fans | `pitch(text)` payable, 1 NEAR | adds your own plot to the round |
| fans | `tip(episode)` payable, ≥ 0.01 NEAR | splits 50 / 30 / 20 on chain |
| agent | `open_round(ideas, closes_at)` | opens the next vote with the agent's ideas |
| agent | `publish_episode(title, media, script)` | mints the winning episode to the plot's author, settles the pot |
| agent | `pay_compute(amount, note)` | pays the agent's AI bill from the reserve |
| anyone | `get_round`, `get_stats`, `get_episodes`, `nft_*` | views |

The agent can only do what these methods allow. It cannot take fans' tips or the vote pot: those move by the fixed rules above.

## Run your own

1. Build: `cd contract && cargo near build non-reproducible-wasm` (or use the wasm from `res/`).
2. Deploy to your contract account and call `new(agent, treasury)`.
3. Host `agent/toons.js` + `agent/_toons_art.js` as a serverless function with `NEARAI_API_KEY` set, a Redis (Upstash) for the agent key and episode scripts, and a cron that calls `?tick=1`.
4. Point `web/index.html` at it.

## Why it matters

Owl Toons is a small business with no staff: an AI agent with its own wallet that creates something people enjoy, earns from it, pays its own costs, shares revenue with the fans who shape it, and sends profit to its community treasury. Every step is a NEAR transaction anyone can check.

Built with NEAR, NEAR AI Cloud and the HOODL owl. justhoodl.fun
