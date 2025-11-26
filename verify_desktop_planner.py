
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Listen for console events and print them
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        try:
            print("Navigating to http://localhost:8000/index.html#planner")
            await page.goto("http://localhost:8000/index.html#planner", wait_until="domcontentloaded")

            print("Waiting for [data-route='planner'] to be visible...")
            await page.wait_for_selector("[data-route='planner']", timeout=20000)

            print("Planner section is visible. Capturing screenshot...")
            await page.screenshot(path="verification_screenshot.png")
            print("Screenshot captured successfully.")

        except Exception as e:
            print(f"An error occurred: {e}")
            await page.screenshot(path="verification_error.png")
            print("Error screenshot captured.")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
