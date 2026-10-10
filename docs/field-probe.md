# Field probe: run this before we build anything else

This one-page test checks that the checkout app can work on the front-desk PCs. It takes about 10 minutes. You need both front-desk PCs, the USB stick, and Chrome or Edge on each.

## What to copy

Copy one file from the project to the USB stick: `dist-probe/probe.html`. Nothing is installed and no admin rights are needed.

## On each PC (do this on PC A and PC B)

1. Plug in the USB stick. Double-click `probe.html` (or drag it into Chrome or Edge). The address bar should start with `file:///`.
2. Look at **1. Storage**. It should say **PASS** by itself.
3. In **2. Camera**, press **Test camera**. If the browser asks to use the camera, click **Allow**. Point this PC's webcam at the sample code shown on the OTHER PC's probe page (or at a printout of it; a code on a PC's own screen cannot be seen by its own webcam) and check it says **PASS**. If only one PC has a webcam, run the camera test on that one and note it.

## Connecting the two PCs (section 3)

1. On PC A press **I am PC A (Host)**. A QR code and a block of text appear.
2. On PC B press **I am PC B (Guest)**. Point PC B's camera at PC A's screen. If the camera does not work, click **Copy** under PC A's code, then paste it into PC B's "Pasted code" box and press **Use pasted code** (send it across using the USB stick, email, or a chat message).
3. PC B now shows a reply code. Do the same in the other direction: scan it with PC A's camera, or copy it and paste it into PC A's "Pasted code" box, then press **Use pasted code**.
4. Wait up to 20 seconds. Both PCs should show **PASS**; PC A also shows a round-trip time in milliseconds.
5. If Chrome asks to allow access to devices on the local network, click **Allow**. Then answer the question "Did Chrome ask about local network access?" at the bottom of section 3.
6. Press **Start over** and repeat once with the PCs swapped (PC B as Host) if you have time.

## Sending us the results

On each PC press **Copy results** at the bottom and paste into an email. Include which PC it was.

## How to read the results

| Check | PASS means | FAIL means |
|---|---|---|
| Storage | The browser can save data from a file on the USB stick. | Data cannot be saved from `file://`. |
| Camera opens / reads a QR code | The webcam can be used and codes can be read. | The webcam is blocked or missing, or codes cannot be read. |
| Connect two PCs | The PCs can talk directly through Windows Firewall. | Nothing got through within 20 seconds (usually Windows Firewall, or the PCs are on different networks). |

## What a failure means (design spec section 5.5)

- **Storage or camera FAIL, or the page will not open from `file://`:** we change how the app is delivered. It becomes a hosted page that installs for offline use (a PWA) instead of a file on a USB stick.
- **Connect two PCs FAIL** (after one retry on the same network): the browser-only design is not viable on these PCs. Do not try to work around it. Send the results back and we will rethink the approach.
- **Chrome asked about local network access:** that is fine if clicking Allow made the test pass. If it asked and the test only passed after Allow, we will add a "click Allow" note to the app's instructions. If it never asked, nothing to do.
- **Connection types:** "host (IP address)" or "host (.local name)" both work. "none gathered" means the PC blocked network discovery; report it.
