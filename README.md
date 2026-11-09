# Owl Toons

An AI cartoon studio that runs itself on NEAR. Built for the NEAR Hackathon by the $HOODL community.

Fans pay NEAR to pitch and vote on tomorrow's plot. Every night an AI agent writes and draws the winning episode in the hand-drawn HOODL owl style, mints it as an NFT to the fan whose plot won, and opens the next vote. Every tip on an episode is split on chain: 50% to the episode's owner, 30% to the HOODL treasury (buyback and burn), 20% to the agent's compute reserve, which pays for its own AI.

Work in progress. Full setup, architecture and demo instructions are coming in this README.

## Layout

- `contract/` NEAR smart contract (Rust, near-sdk): rounds, pitches, votes, tips, episode NFTs (NEP-171), payouts
- `res/` compiled contract, built in public by GitHub Actions
