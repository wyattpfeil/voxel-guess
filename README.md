# Voxel Guess

A classroom multiplayer guessing app for a 3D voxel-modeling game. The teacher sets the word and controls the round. Students join from a browser, type guesses, receive automatic hints, and earn speed-based points.

## Quick start on Mac

1. Install Node.js from https://nodejs.org if it is not already installed.
2. Double-click `Start Voxel Guess.command`.
   - The first run installs the two required packages.
   - If macOS blocks it, right-click the file, choose **Open**, then choose **Open** again.
3. The terminal prints:
   - a private **Teacher controls** link
   - one or more **Student Wi-Fi links**
4. Open the teacher link on your computer.
5. Give students the Wi-Fi link. Everyone must be on the same network.
6. Keep the terminal window open while playing.

## Quick start on Windows

1. Install Node.js from https://nodejs.org if needed.
2. Double-click `Start Voxel Guess.bat`.
3. Open the teacher link printed in the window and share the Student Wi-Fi link.

## Manual start

```bash
npm install
npm start
```

Then open the teacher URL printed in the terminal.

## Included features

- Teacher-only control link with a random secret token
- Custom words and phrases
- Automatic Skribbl-style letter reveals
- Manual reveal and end-round controls
- 30-second to 10-minute rounds (preset buttons show common choices)
- Live guess chat
- Correct answers hidden from the chat
- “Very close” feedback for small spelling mistakes
- Speed- and placement-based points
- Live leaderboard
- Player reconnection after refreshing
- Remove-player, clear-chat, and reset-score controls

## Notes

- The game state is stored only in memory and resets when the server closes.
- Students need access to the same local network as the teacher computer.
- Some school Wi-Fi networks block device-to-device connections. In that case, use a personal hotspot, or deploy the app to a public Node.js host.
# voxel-guess
