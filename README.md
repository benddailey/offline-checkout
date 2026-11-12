# Offline Checkout

Offline Checkout lets front-desk staff keep checking items out when the library system is down. Scan
each patron's card and their items as usual; the app records them on the PC. Several desk PCs can
share one session. At the end of every checkout a receipt prints on the receipt printer, with the
patron's barcode and one barcode per item. Staff keep the receipts at the desk, and when the system
is back they scan them into the library system. A PDF with a barcode for every patron and item in
the session is also available as a complete copy.

It runs in Chrome, Edge or Chromium on Windows, macOS and Linux. It needs no internet, no server, no
admin rights and no installs. When the PC is online, it downloads the optional photo backgrounds
(about 5 MB, once per PC) from GitHub; nothing about your sessions or patrons is sent.

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
received in the last 3 days. It shows when that desk last scanned, not whether it is on now.

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
      Or click **Save to file** and put the file where the new PC can reach it, such as a shared
      network drive or a flash drive. On the new PC, click **Load code from file** (or drag the
      file onto the code box).
   4. The new PC then shows a reply code. Give it to the first PC the same way, the other way round.

   Codes expire after 15 minutes and work once. If a code expires, click **Try again** for a new
   one. A saved code file is temporary, so delete it after pairing.

3. **Scan.** Scan the patron's card, then each item. There is no need to click anything first. The
   newest item is at the top of the list. The bar at the top shows totals and a green or red dot for
   each desk PC, with **not connected** beside any that dropped.
   - **End the patron**: scan **OC-END** on the scanner card, or click **End patron**. Their receipt
     prints, with the patron barcode and one barcode per item. Keep the receipt at the desk (don't
     give it to the patron): it is what gets scanned into the library system later.
   - **Undo the last item**: scan **OC-VOIDLAST**, or click **Void** on a row. **Void patron**
     cancels the whole visit and prints nothing. It asks first if the patron has items.
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

   **Close session** can't be undone. To stop for the day, use **Exit session** instead and resume
   tomorrow.

6. **Combining sessions.** An outage can span several sessions, for example when Friday's session is
   closed expecting a fix and Saturday gets a new one. To upload everything to Evergreen once, open
   the session that should hold it all, scroll to **Add to this session** on the Summary, and add the
   others. It can be open or closed, and stays as it was. The session then holds every checkout in
   time order, and every export covers all of it.
   - **Prefer another session on this PC.** It copies the real record, so use a file only for a
     session that was on another PC, or has been deleted. The sessions on this PC are listed under
     **Add to this session**. Anything scanned in a source session after you add it needs adding
     again, which adds only what is new.
   - **Files.** Click **Choose files**, or drag files onto the box. A file dropped anywhere else is
     blocked, so nothing opens by mistake. Prefer the Excel or Evergreen file over the CSV: Excel can
     damage barcodes in a CSV, and the app refuses a CSV saved by Excel. A PDF can't be added, because
     it has no scan times. Only files this app made can be added. An Evergreen file has no clerk
     names, so those checkouts are listed under a clerk named **Imported** in **By clerk**, in the
     Clerk column of the CSV and Excel files and in the PDF.
   - **Check the preview.** Every source is shown in a preview, with its patrons and items, before
     anything changes. Enter **Your name**; it is required. Click **Add to session** to confirm.
     Adding the same source twice adds nothing new.
   - **An addition can't be undone.** After a wrong addition, start a new session and add the right
     sources to that instead. The sources are never changed, and you can delete the wrong session.
   - **Export after the last scan or void.** An export made earlier does not include later changes.
   - **Avoid uploading twice.** If you download for Evergreen and then add more, the Summary warns
     that items were added after the last Evergreen download. The new file contains every checkout in
     the session, so upload only one of them unless the earlier one was never uploaded. Deleting the
     session also asks you to download the Evergreen file again.
7. **Deleting a closed session.** When every export you need is done, click **Delete session** on
   the Summary of a closed session. It lists each export (PDF, CSV, Excel, Evergreen) with the time,
   clerk and desk PC that downloaded it, or says none was downloaded. If the Evergreen file was never
   downloaded, download it first unless the checkouts are already in Evergreen. Drag the slider all
   the way to the end to delete. The session is removed from this PC and from every connected desk PC,
   and it cannot be undone. A desk PC that was not connected keeps its copy until you delete it there.
   A session that is still open can't be deleted.

## Good to know

- Sessions are stored in the browser on that PC. Don't clear the browsing data of the Offline
  Checkout window, or the sessions are lost.
- Chrome may ask for camera permission each time you join PCs by webcam.
- Receipts print without a dialog only from the **Offline Checkout** shortcut. If the print dialog
  appears, close every Offline Checkout window and open the app from that shortcut.
- To change the receipt printer, repeat **Choose the receipt printer** from the setup.
- Test the printed barcodes with your own scanners before you rely on them.
- **Print staff barcodes** on the start screen makes login barcodes for Avery 5371 business cards
  (10 per sheet).
  - Type each login exactly as it should scan. Capital and small letters are kept; spaces before
    and after are dropped.
  - **Fill the rest** copies a card into every card after it. Cards run left to right, then top to
    bottom, as on the sheet. Empty cards are left blank.
  - Click **Generate PDF** and print it at **Actual size**, not **Fit to page**.
  - Faint dotted lines mark the card edges, for cutting plain card stock by hand.
  - Nothing typed there is saved.
- **Theme** at the top of the screen opens a menu with two choices. You can change them even in
  the middle of a patron, and each PC remembers its own.
  - **Theme:** **Light** or **Dark**.
  - **Background:** **None**, **Evergreen shelves**, or a photo of a famous library. Evergreen
    shelves has one book for each Evergreen Indiana library, sized by the population it serves.
    The photos are listed once the PC has downloaded them, the first time it opens the app while
    online; open it once before an outage to have them. The menu credits the chosen photo;
    `THIRD-PARTY-NOTICES.txt` credits every photo.
  - With a background, drag the middle panel by its edge or any empty space in it, for example to
    uncover your library's book. Double-click that space to put the panel back.
  - Receipts and QR codes look the same with every choice.

## License

Offline Checkout is free software under the GNU Affero General Public License, version 3 or later.
The source code is at https://github.com/benddailey/offline-checkout. In the zip, `LICENSE.txt` is
the license and `THIRD-PARTY-NOTICES.txt` lists the open-source libraries the app includes.

Developers: see DEVELOPMENT.md.
