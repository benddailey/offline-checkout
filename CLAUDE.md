# Offline Checkout

- Read DEVELOPMENT.md for the stack, build, tests and the release steps.
- README.md is for library staff, not developers.
  - Update it when anything staff can see changes.
  - Keep it to headings, lists, bold, inline code and links: `npm run package:windows` turns it
    into README.txt for the release zip.
- Developer changes go in DEVELOPMENT.md.
- The repo is benddailey/offline-checkout.
  - PRs, merges and releases use `gh`.
  - Attach test builds as a zip.
- Before a PR: `npx vp check`, `npx vp test run` and `npm run e2e` must pass. The e2e run needs a
  display, and it rebuilds and clears `dist/`.
- `windows/Create shortcuts.cmd` must stay ASCII. It is checked out with CRLF line endings
  (.gitattributes).
- All workstations must run the same version, because pairing codes carry a format version (`OC2:`).
  Changing the pairing payload means bumping that prefix.
