# Offline Checkout

Offline Checkout lets front-desk staff keep checking items out when the library system is down. Scan
each patron's card and their items as usual; the app records them on the PC. Several desk PCs can
share one session. At the end of every checkout a receipt prints on the receipt printer, with the
patron's barcode and one barcode per item. Staff keep the receipts at the desk, and when the system
is back they scan them into the library system. A PDF with a barcode for every patron and item in
the session is also available as a complete copy.

It runs in Chrome, Edge or Chromium on Windows, macOS and Linux. It needs no internet, no server, no
admin rights and no installs.

## What you need

- A computer at each desk with one of these browsers:
  - Windows: Google Chrome or Microsoft Edge.
  - Mac: Google Chrome or Microsoft Edge.
  - Linux: Chromium, Google Chrome or Microsoft Edge.
- A USB barcode scanner that reads Code 128 barcodes and sends Enter after each scan. To join PCs
  from a printed code, it must also send Enter or Tab after each scan.
- Optional: a webcam on each PC, to join PCs by holding a QR code up to the camera.
- A receipt printer for 80 mm paper rolls (72 mm print width) installed on the computer, for the checkout
  receipts that are scanned back in later, and for printed join codes. Tested with a Star TSP143;
  other receipt printers should work, but print a test receipt and scan it first.

## Setting up a desk PC

Do this before an outage, on every desk PC.

1. Download the latest zip (`offline-checkout-vX.Y.Z.zip`) from the releases page:
   https://github.com/benddailey/offline-checkout/releases
   The same zip works on Windows, Mac and Linux.
2. Extract it and run the setup script for your computer, as described below. It installs the app
   for this user and creates two shortcuts:
   - **Offline Checkout**: use this every day. Receipts print straight to the printer. Its icon is
     a crossed-out evergreen tree.
   - **Offline Checkout - printer setup**: use this once, to choose the receipt printer. Its icon
     has a small printer in the corner.
3. Choose the receipt printer, as described after the steps for each system.

### Windows

1. Right-click the zip, choose **Extract All**, and open the extracted folder.
2. Double-click **Windows - Create shortcuts.cmd**. If Windows warns that the file came from the
   internet, choose **More info** and **Run anyway** (or **Run**).
3. The two shortcuts are on the desktop.

### Mac

1. Double-click the zip to extract it, and open the extracted folder.
2. Double-click **Mac - Create shortcuts.command**. It opens in Terminal.
3. The first time, macOS says it cannot verify the file. Click **Done**, then open
   **System Settings > Privacy & Security**, scroll down, click **Open Anyway** next to the message
   about the file, and confirm. Alternatively, open **Terminal**, type `bash ` (with a space), drag the file into
   the Terminal window and press Return.
4. The two apps are in the **Applications** folder in your home folder, which the script opens. Drag
   them to the Dock to keep them handy.

### Linux

1. Extract the zip (in most file managers, right-click it and choose **Extract Here**), and open the
   extracted folder.
2. Right-click in the folder, choose **Open in Terminal**, type `bash "Linux - Create shortcuts.sh"`
   and press Enter. (Double-clicking it usually opens it in a text editor instead.)
3. The two shortcuts are in the app menu and on the desktop, if the desktop shows icons. On a
   GNOME desktop, if a shortcut asks first, right-click it and choose **Allow Launching**.
4. The app and its stored sessions are in the **OfflineCheckout** folder in your home folder. Keep
   that folder.

### Name the desk PC

The first time Offline Checkout opens on a PC (in the printer setup below, or the first time you use
it) it asks for a **Workstation name**, such as **Front desk 1**. Use a different name on each desk
PC. Every scan is recorded with this name and the clerk's, so the Summary and the exports show where
each scan was made. To change it later, click **Rename** next to the name on the start screen. Scans
already made keep the old name.

Once another desk's scans in an open session have synced to this PC, the start screen lists that
desk under **Other workstations**, with its session and the time of its last activity this PC has
received. It shows when that desk last scanned, not whether it is on now.

### Choose the receipt printer

Do this once on every desk computer, after the setup script:

1. Close every Offline Checkout window.
2. Open **Offline Checkout - printer setup**, name the PC if it asks, start a session, and click
   **Receipt printer** under Scanner card.
3. In the print dialog choose the receipt printer and click **Print**. Keep the scanner card at the
   desk.
4. Close the window. From now on, use **Offline Checkout**.

The extracted folder is no longer needed after setup; you can delete it.

## Updating

Every desk PC must run the same version, or they cannot join each other. The version is shown next
to the title on the start screen and on the Summary.

1. Finish any running session first. Don't update during an outage.
2. Download and extract the new zip and run its setup script, as in setup. Stored sessions and the
   chosen printer are kept.
3. If the PC has no workstation name yet, it asks for one the first time it opens, as in
   **Name the desk PC**.

## Using it at the desk

1. **Start.** Open **Offline Checkout**.
   - **Going back to a session** (after a shift change, a crash or a restart): if a session is still
     open and anything was scanned in it in the last 3 days, it is at the top under **Open
     sessions**, ready for your name. Enter your name and click **Resume session**. To resume a
     different open session, click it instead.
   - **New session**: enter a session name (it defaults to today's date) and your name, and click
     **Start session**. When open sessions are listed at the top, click **Start new session** below
     them first.
   - Each session shows the last clerk and when it started. Closed sessions show when they were
     closed, and open straight to their Summary.
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
   - Need a scanner card? It is offered when a session starts, until the first patron is scanned,
     and is always on the Summary: **Receipt printer** prints it on the receipt roll, and
     **Letter PDF** saves it for a regular printer.
4. **Summary.** Click **Summary** for totals, a count per clerk and per desk PC, and every patron
   with their items. A desk PC that is not connected is listed by its clerk and name, for example
   **Not connected: Ann (Front desk 2)**.
   - **Change clerk**: when someone takes over the desk, click **Change clerk** and enter your name.
     Scans from then on are counted under your name; earlier scans keep theirs.
   - **Exit session** goes back to the start screen. If other desk PCs are connected, it asks first:
     this PC disconnects, and after resuming you re-pair it with any desk PC.
   - Finish the current patron first: these buttons, **Add workstation** and **Summary** wait until
     the patron is ended or voided.
5. **When the system is back.** On the Summary click **Close session**. Every desk PC stops taking
   scans. Scan the kept receipts into the library system: the patron barcode, then each item.
   **Generate PDF** makes a copy of the whole session on US Letter paper, with a barcode for every
   patron and item. Use it for a receipt that is lost or won't scan, or to check nothing was missed.
   **Download CSV** and **Download Excel** save the same list as a spreadsheet, one row per item,
   with the patron, item, time scanned, clerk, workstation and session name. Open the Excel file in Excel: it
   keeps barcodes exactly as scanned. Excel can change barcodes in the CSV, for example by dropping
   leading zeros, and a barcode that starts with `-` or `+` has a `'` added in front of it.
   **Download for Evergreen** saves every checkout as an Evergreen offline transaction file (the
   same format as Evergreen's `pending.xacts`). To load it, sign in to Evergreen, go to
   **Circulation > Offline Circulation > Session Management**, click **Import Transactions** and
   pick the file. The checkouts appear under **Pending Transactions**. Create a session, then click
   **Upload** and **Process**. Evergreen sets each due date from the library's loan rules, counting
   from the time the item was scanned, and lists any problems under **Exceptions**. Upload each
   file once: the second upload would check every item out again.

## Good to know

- Sessions are stored in the browser on that PC. Don't clear the browsing data of the Offline
  Checkout window, or the sessions are lost.
- Chrome may ask for camera permission each time you join PCs by webcam.
- Receipts print without a dialog only from the **Offline Checkout** shortcut. If the print dialog
  appears, close every Offline Checkout window and open the app from that shortcut.
- To change the receipt printer, repeat **Choose the receipt printer** from the setup.
- Test the printed barcodes with your own scanners before you rely on them.

## License

Offline Checkout is free software under the GNU Affero General Public License, version 3 or later.
The source code is at https://github.com/benddailey/offline-checkout. In the zip, `LICENSE.txt` is
the license and `THIRD-PARTY-NOTICES.txt` lists the open-source libraries the app includes.

Developers: see DEVELOPMENT.md.
