import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        try:
            await page.goto("http://localhost:8000/mobile.html")
            await page.wait_for_selector("#mobile-fab-button", timeout=5000)

            # Open the FAB menu and tap "New Reminder"
            await page.click("#mobile-fab-button")
            await page.wait_for_selector("#mobile-footer-new-reminder", timeout=3000)
            await page.click("#mobile-footer-new-reminder")

            # The "reminders" view should be visible
            reminders_view_visible = await page.is_visible('[data-view="reminders"]')

            # The "notebook" view should be hidden
            notebook_view_hidden = await page.is_hidden('[data-view="notebook"]')

            # Take a screenshot to visually verify the result
            await page.screenshot(path="screenshot.png")

            if reminders_view_visible and notebook_view_hidden:
                print("Test passed: 'New Reminder' button correctly shows the 'reminders' view.")
            else:
                print(f"Test failed: 'New Reminder' button did not show the correct view. Reminders visible: {reminders_view_visible}, Notebook hidden: {notebook_view_hidden}")

        except Exception as e:
            print(f"An error occurred: {e}")
            await page.screenshot(path="error_screenshot.png")

        finally:
            await browser.close()

asyncio.run(main())
