# User Workflow Preferences

To ensure the most efficient collaboration, please follow these rules:

## Browser & UI Testing
- **Do NOT attempt to start a local server** (like `http-server` or `npx`) automatically. It is slow and often unnecessary.
- **DO NOT attempt to open `file:///` URLs** directly using browser tools (they are blocked by security).
- **Request the User to open the file**: If you need to see the UI or debug the page, simply ask the user: *"Please open index.html in your browser"*.
- once the user opens the file, you can then use browser subagents to interact with the already open page.
- If direct browser access is not working, ask the user for a screenshot.

## Communication
- Keep responses concise and focus on results.
- If a calculation logic seems complex, double-check the math or ask for clarification before implementing.
