# Offline Checkout

Offline Checkout lets front-desk staff keep checking items out when the library system is down. Scan
each patron's card and their items as usual; the app records them on the PC. Several desk PCs can
share one session. At the end of every checkout a receipt prints on the receipt printer, with the
patron's barcode and one barcode per item. Staff keep the receipts at the desk, and when the system
is back they scan them into the library system. A PDF with a barcode for every patron and item in
the session is also available as a complete copy.

It runs in Chrome or Edge. It needs no internet, no server, no admin rights and no installs.

## What you need

- A Windows PC with Chrome (or Edge) at each desk.
- A USB barcode scanner that reads Code 128 barcodes and sends Enter after each scan. To join PCs
  from a printed code, it must also send Enter or Tab after each scan.
- Optional: a webcam on each PC, to join PCs by holding a QR code up to the camera.
- A receipt printer for 80 mm paper rolls (72 mm print width) installed in Windows, for the checkout
  receipts that are scanned back in later, and for printed join codes. Tested with a Star TSP143;
  other receipt printers should work, but print a test receipt and scan it first.

## Setting up a desk PC

Do this before an outage, on every desk PC.

1. Download the latest Windows zip from the releases page:
   https://github.com/benddailey/offline-checkout/releases
2. Right-click the zip, choose **Extract All**, and open the extracted folder.
3. Double-click **Create shortcuts.cmd**. If Windows warns that the file came from the internet,
   choose **More info** and **Run anyway** (or **Run**). It installs the app for this Windows user
   and puts two shortcuts on the desktop:
   - **Offline Checkout**: use this every day. Receipts print straight to the printer.
   - **Offline Checkout - printer setup**: use this once, to choose the receipt printer.
4. Choose the receipt printer:
   1. Close every Offline Checkout window.
   2. Open **Offline Checkout - printer setup**, start a session, and click **Receipt printer**
      under Scanner card.
   3. In the print dialog choose the receipt printer and click **Print**. Keep the scanner card at the
      desk.
   4. Close the window. From now on, use **Offline Checkout**.

The extracted folder is no longer needed after setup; you can delete it.

## Updating

Every desk PC must run the same version, or they cannot join each other. The version is shown next
to the title on the start screen and on the Summary.

1. Finish any running session first. Don't update during an outage.
2. Download and extract the new zip and run its **Create shortcuts.cmd**, as in setup. Stored
   sessions and the chosen printer are kept.

## Using it at the desk

1. **Start.** Open **Offline Checkout**. Enter a session name (it defaults to today's date) and your
   name, and click **Start session**. After a crash or restart, pick the session from the
   **Resume** list instead.
2. **Add another desk PC.**
   1. On the PC already running the session, click **Add workstation**. It shows a join code.
   2. On the new PC, click **Join session** and enter your name.
   3. Give the new PC the join code. Either hold the first PC's screen up to the new PC's webcam,
      or click **Print code** on the first PC and scan every barcode on the receipt with the new
      PC's scanner, in any order. The progress line shows which
      barcodes are still missing. Scanning one twice does no harm, and **Start over** clears them.
   4. The new PC then shows a reply code. Give it to the first PC the same way, the other way round.

   Codes expire after 5 minutes and work once. If one expires, click **Try again** for a new one.

3. **Scan.** Scan the patron's card, then each item. There is no need to click anything first. The
   bar at the top shows totals and a green or red dot for each desk PC.
   - **End the patron**: scan **OC-END** on the scanner card, or click **End patron**. Their receipt
     prints, with the patron barcode and one barcode per item. Keep the receipt at the desk (don't
     give it to the patron): it is what gets scanned into the library system later.
   - **Undo the last item**: scan **OC-VOIDLAST**, or click **Void** on a row. **Void patron**
     cancels the whole visit and prints nothing.
   - Voided entries stay on screen crossed out. Nothing is ever deleted.
   - Need a scanner card? It is offered when a session starts, and is on the Summary: **Receipt printer** prints it on the receipt
     roll, and **Letter PDF** saves it for a regular printer.
4. **Summary.** Click **Summary** for totals, a count per clerk, and every patron with their items.
5. **When the system is back.** On the Summary click **Close session**. Every desk PC stops taking
   scans. Scan the kept receipts into the library system: the patron barcode, then each item.
   **Generate PDF** makes a copy of the whole session on US Letter paper, with a barcode for every
   patron and item. Use it for a receipt that is lost or won't scan, or to check nothing was missed.

## Good to know

- Sessions are stored in the browser on that PC. Don't clear the browsing data of the Offline
  Checkout window, or the sessions are lost.
- Chrome may ask for camera permission each time you join PCs by webcam.
- Receipts print without a dialog only from the **Offline Checkout** shortcut. If the print dialog
  appears, close every Offline Checkout window and open the app from that shortcut.
- To change the receipt printer, repeat step 4 of the setup.
- Test the printed barcodes with your own scanners before you rely on them.

## License

Offline Checkout is free software under the GNU Affero General Public License, version 3 or later.
The source code is at https://github.com/benddailey/offline-checkout.

Developers: see DEVELOPMENT.md.
