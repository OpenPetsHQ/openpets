# Install OpenPets

Use this workflow when the user asks to install or start using OpenPets.

## Steps

1. Identify the user's OS if needed.
2. Direct the user to install the desktop app from the official OpenPets website/docs.
3. Ask the user to launch the desktop app and complete first-run onboarding.
4. Install the CLI if the user wants the clean `openpets` command:

```bash
   npm install -g @open-pets/cli@latest
```

5. Verify the app is reachable:

```bash
openpets status
```

   One-off fallback: `npx -y @open-pets/cli@latest status`.

6. If an MCP-capable agent is already configured, verify with `openpets_status`.

## Notes

- The desktop app must be running for live pet control.
- If status cannot connect, check that the app is open and that local IPC is not blocked.
- If installation repeatedly fails, ask the user to report the issue at https://github.com/OpenPetsHQ/openpets/issues with OS/version details.
