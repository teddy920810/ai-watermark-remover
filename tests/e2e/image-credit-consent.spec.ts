import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { imageOperationFixture, stroke } from '../helpers/image-operation-fixture';

test('mobile object selection recovers a canvas scrolled behind the header and shows its quoted charge', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  const state=await imageOperationFixture(page,{operation:'object-removal',autoSelect:false});
  const canvas=page.getByLabel('Object removal mask canvas');
  await canvas.evaluate(element=>window.scrollTo({top:window.scrollY+element.getBoundingClientRect().top+28,behavior:'instant'}));
  await stroke(page); await expect(page.getByRole('button',{name:'Remove object · 10 image credits',exact:true})).toBeEnabled();
  expect(state.masks).toHaveLength(1); expect(state.submissions).toBe(0);
});

test('object shows its exact quote before one confirmation, then preserves the image and purchase return path after a 402', async ({ page }) => {
  const state=await imageOperationFixture(page,{operation:'object-removal'}); state.rejectBalance=true;
  await expect(page.getByLabel('Processing cost')).toContainText('10 image credits');
  const sent=page.waitForRequest(request=>request.url().endsWith('/api/v1/jobs')&&request.method()==='POST');
  await page.getByRole('button',{name:'Remove object · 10 image credits',exact:true}).evaluate(element=>{(element as HTMLButtonElement).click();(element as HTMLButtonElement).click();});
  expect((await sent).postDataJSON()).toMatchObject({quoteId:'image-quote-1',idempotencyKey:expect.any(String)});
  await expect(page.getByRole('alert').first()).toContainText('No image credits remaining');
  const link=page.getByRole('link',{name:'Buy image credits',exact:true});await expect(link).toHaveAttribute('href',`/pricing?returnTo=${encodeURIComponent('/app?operation=object-removal')}`);await expect(link).toHaveAttribute('target','_blank');
  await expect(page.getByText('background-source.png',{exact:true})).toBeVisible();expect(state.submissions).toBe(1);expect(state.oldRequests).toBe(0);
});

test('object sign-in prepares the latest price without accepting it or spending the retained selection', async ({ page }) => {
  await page.addInitScript(()=>{window.open=()=>({location:{href:''},close(){}}) as unknown as Window;});
  await page.route('**/api/auth/sign-in/social',route=>route.fulfill({json:{url:'https://accounts.google.test/fixture'}}));
  const state=await imageOperationFixture(page,{operation:'object-removal',initiallySignedIn:false});
  await page.getByRole('button',{name:'Sign in to continue',exact:true}).click(); state.signedIn=true;state.cost=20;
  await page.evaluate(()=>window.postMessage({type:'clearmark-auth-complete'},location.origin));
  await expect(page.getByRole('button',{name:'Remove object · 20 image credits',exact:true})).toBeEnabled();
  expect(state.submissions).toBe(0);expect(state.masks).toHaveLength(1);expect(state.purchasedImageCredits).toBe(100);
  await page.getByRole('button',{name:'Remove object · 20 image credits',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download PNG',exact:true})).toBeVisible();expect(state.submissions).toBe(1);expect(state.purchasedImageCredits).toBe(80);
});

test('cancelled sign-in retains the object selection and a later sign-in still cannot process automatically', async ({ page }) => {
  await page.addInitScript(()=>{window.open=()=>({location:{href:''},close(){}}) as unknown as Window;});
  await page.route('**/api/auth/sign-in/social',route=>route.fulfill({status:400,json:{message:'Sign-in cancelled'}}));
  const state=await imageOperationFixture(page,{operation:'object-removal',initiallySignedIn:false});
  await page.getByRole('button',{name:'Sign in to continue',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  state.signedIn=true;await page.evaluate(()=>window.postMessage({type:'clearmark-auth-complete'},location.origin));
  await expect(page.getByRole('button',{name:'Remove object · 10 image credits',exact:true})).toBeEnabled();
  expect(state.submissions).toBe(0);expect(state.masks).toHaveLength(1);expect(state.oldRequests).toBe(0);
});

test('unavailable object quotes disable processing until retry, while reusing the sealed selection', async ({ page }) => {
  const state=await imageOperationFixture(page,{operation:'object-removal',quoteUnavailable:true});
  await expect(page.getByRole('alert')).toContainText('Processing cost unavailable');
  await expect(page.getByRole('button',{name:'Remove object',exact:true})).toBeDisabled();state.quoteUnavailable=false;
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove object · 10 image credits',exact:true})).toBeEnabled();
  expect(state.masks).toHaveLength(1);expect(state.uploads).toBe(2);expect(state.submissions).toBe(0);
});

test('object spends one free use without consuming purchased or administrator credits and reviews both real sources', async ({ page }) => {
  const state=await imageOperationFixture(page,{operation:'object-removal',autoSelect:false});state.freeUses=1;
  await stroke(page);await page.getByRole('button',{name:'Remove object · 1 free image use',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download PNG',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Original',exact:true}).click();await expect(page.getByAltText('Selected image preview',{exact:true})).toHaveAttribute('src','/fixture/durable-input.png');
  await page.getByRole('button',{name:'Result',exact:true}).click();await expect(page.getByAltText('Selected image preview',{exact:true})).toHaveAttribute('src','/fixture/durable-result.png');
  expect(state.freeUses).toBe(0);expect(state.purchasedImageCredits).toBe(100);expect(state.submissions).toBe(1);await expect(page.locator('.workspace-balances')).toContainText('77 processing credits');
});

test('object paste uses the common file checks without submitting a task', async ({ page }) => {
  const state=await imageOperationFixture(page,{operation:'object-removal',autoSelect:false});
  // A replacement paste is ignored while the initial file is still opening.
  await expect(page.getByText('background-source.png',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Upload file to workspace')).toBeEnabled();
  const image=await sharp({create:{width:80,height:60,channels:3,background:'#aabbcc'}}).png().toBuffer();
  await page.evaluate(base64=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(base64),value=>value.charCodeAt(0))],'pasted-image.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));},image.toString('base64'));
  await expect(page.getByText('pasted-image.png',{exact:true})).toBeVisible();expect(state.submissions).toBe(0);expect(state.oldRequests).toBe(0);
});
