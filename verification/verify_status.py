from playwright.sync_api import sync_playwright

def verify_status_indicators():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the mobile page
        page.goto("http://localhost:8080/mobile.html")

        # Click the "New Note" button to open the notebook view where the status is
        # Note: The ID in the HTML is 'newNoteMobile' inside '.note-actions'
        # But wait, looking at my diff, the status indicators are IN the '.note-actions' div,
        # alongside the 'New' and 'Save' buttons.
        # So they should be visible (or present in DOM) when the notebook view is active.

        # To see the notebook view, we might need to navigate to it or open a note.
        # Let's try clicking the "Notes" footer button if it exists, or just inspect the DOM if it's there.
        # The mobile.html has data-active-view="reminders" by default.

        # Click "Notes" tab in footer
        page.click("#mobile-footer-notebook")

        # Wait for the notebook view to be active
        page.wait_for_selector("#view-notebook")

        # Check if the status elements exist
        sync_status = page.locator("#notesSyncStatus")
        status_text = page.locator("#notesStatusText")

        # They might be hidden initially or empty, but they should exist in the DOM
        if sync_status.count() > 0 and status_text.count() > 0:
            print("Status indicators found in DOM.")
        else:
            print("Status indicators NOT found.")

        # The 'notesSyncStatus' has class 'hidden' by default in my change: <span id="notesSyncStatus" class="sync-dot hidden"></span>
        # The 'notesStatusText' has text 'Ready': <span id="notesStatusText" role="status">Ready</span>

        # Let's make sure the text is correct
        expect_text = "Ready"
        actual_text = status_text.inner_text()
        print(f"Status text: '{actual_text}'")

        # Take a screenshot of the notebook footer area
        # We can try to scroll to bottom or just screenshot the viewport
        page.screenshot(path="verification/status_indicators.png")

        browser.close()

if __name__ == "__main__":
    verify_status_indicators()
