import os
from playwright.sync_api import sync_playwright

def verify_sidebar():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Emulate a mobile device
        context = browser.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
        )
        page = context.new_page()

        # Load the mobile file directly
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/mobile.html")

        # Wait for app
        page.wait_for_timeout(1000)

        # Click the notebook tab (middle/last button on bottom nav)
        # Try to find the notebook button in the bottom nav
        try:
            page.locator("#mobile-footer-notebook").click(timeout=2000)
        except:
            # Fallback for bottom nav in docs/mobile.html version if IDs differ
            page.get_by_role("button", name="Notebook").click()

        page.wait_for_timeout(1000)

        # Click "Saved notes" to open sidebar
        # Try both ID and text content
        try:
            page.locator("#openSavedNotesSheet").click(timeout=2000)
        except:
            page.get_by_text("Saved notes").click()

        page.wait_for_timeout(1000)

        # Force the saved notes sheet to be open/visible if JS didn't do it
        # This is because in file:// protocol some JS might be blocked or fail
        page.evaluate("document.getElementById('savedNotesSheet').setAttribute('data-open', 'true')")

        page.wait_for_timeout(500)

        # Take screenshot of the sidebar area
        page.screenshot(path="verification/sidebar_mobile.png")

        # Verify specific CSS properties
        width = page.evaluate("window.getComputedStyle(document.querySelector('.notebook-sidebar-nav')).width")
        print(f"Sidebar width: {width}")

        browser.close()

if __name__ == "__main__":
    verify_sidebar()
