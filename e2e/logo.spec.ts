/**
 * The logo (FR-V.5): the MT monogram shows on Setup in the app's Light and
 * Dark colours, and the tab icon is the new one, drawn as MT only at 16 px.
 */
import { expect, test, type Page } from '@playwright/test';

/** The computed fill of the logo's tile and stroke of its letters. */
async function logoColours(page: Page) {
  const logo = page.getByRole('img', { name: 'My Tasks logo' });
  await expect(logo).toBeVisible();
  return logo.evaluate((svg) => ({
    tile: getComputedStyle(svg.querySelector('rect')!).fill,
    letters: getComputedStyle(svg.querySelector('path')!).stroke,
  }));
}

/**
 * Whether the tab icon, drawn at `size` px, shows the check circle: the
 * point below the letters, in the circle, is light when it does and the
 * tile's dark teal when only MT is drawn. The icon is shown in an <img> at
 * that size on a blank page (free of the app's security policy, which would
 * block reading the image back), screenshotted, and the pixel read on a canvas.
 */
async function iconShowsCircle(page: Page, href: string, size: number): Promise<boolean> {
  await page.evaluate(
    ([src, px]) =>
      new Promise<void>((done) => {
        document.getElementById('icon-probe')?.remove();
        const img = Object.assign(new Image(px, px), { id: 'icon-probe', src, onload: () => done() });
        img.style.cssText = 'position:absolute;top:0;left:0;z-index:99999';
        document.body.append(img);
      }),
    [href, size] as const,
  );
  const shot = await page.locator('#icon-probe').screenshot();
  return page.evaluate(
    async ([png, y]) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const [r, g, b] = ctx.getImageData(bitmap.width / 2, bitmap.height * y, 1, 1).data;
      return r + g + b > 450;
    },
    [shot.toString('base64'), 82 / 110] as const,
  );
}

test('the logo follows Light and Dark, and the tab icon is the monogram', async ({ page, context, request }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/app/');
  expect(await logoColours(page)).toEqual({ tile: 'rgb(15, 91, 82)', letters: 'rgb(207, 239, 232)' });

  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await logoColours(page)).toEqual({ tile: 'rgb(23, 119, 107)', letters: 'rgb(230, 247, 243)' });

  await page.emulateMedia({ colorScheme: 'light' });
  const href = new URL((await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href'))!, page.url()).href;
  expect(await (await request.get(href)).text()).toContain('#0F5B52');
  const blank = await context.newPage();
  expect(await iconShowsCircle(blank, href, 64)).toBe(true);
  expect(await iconShowsCircle(blank, href, 16)).toBe(false);
});
