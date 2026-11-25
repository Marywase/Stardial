import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const { chromium, firefox, webkit } = createRequire("/tmp/card-browser/package.json")("playwright");

const root = process.cwd();
await build({
  stdin: { contents: `import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {ProjectCard} from './frontend/src/components/ProjectCard';
    const project = {projectId:'P123',title:'Test Project',projectType:'App',token:'',owner:'GABC',collaborators:[],locked:false,totalDistributed:'0',distributionRound:1,balance:'1500'};
    export const html = renderToStaticMarkup(<main style={{padding:32,display:'grid',gap:24}}>
      <button id="before">Before cards</button>
      <section id="full"><ProjectCard project={project} onSelect={()=>{}} /></section>
      <section id="compact"><ProjectCard project={project} onSelect={()=>{}} userEarnings="25" /></section>
      <section id="readonly"><ProjectCard project={project} /></section>
    </main>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', outfile: '.validation/fixture.cjs',
  jsx: 'automatic', alias: { '@': path.join(root, 'frontend/src') },
});
const { html } = createRequire(import.meta.url)('./fixture.cjs');
const cssFile = path.join(root, 'frontend/src/app/globals.css');
const { css } = await postcss([tailwind({base: path.join(root,'frontend')})]).process(await fs.readFile(cssFile,'utf8'), {from: cssFile});
const document = `<style>${css}</style>${html}`;
const bg = el => el.evaluate(e => getComputedStyle(e).backgroundColor);
for (const [name, engine] of Object.entries({chromium, firefox, webkit})) {
  const browser = await engine.launch();
  const page = await browser.newPage({viewport:{width:1000,height:900}});
  await page.setContent(document);
  for (const id of ['full','compact']) {
    const card = page.locator(`#${id} button`);
    await page.mouse.move(0,0);
    const resting = await bg(card);
    const box = await card.boundingBox();
    await card.hover();
    await page.waitForTimeout(220);
    assert.equal(await bg(card), 'rgb(32, 40, 32)', `${name} ${id} hover`);
    assert.notEqual(resting, await bg(card));
    assert.deepEqual(await card.boundingBox(), box, 'hover must not move card');
    await page.mouse.down();
    await page.waitForTimeout(220);
    assert.equal(await bg(card), 'rgb(23, 59, 43)', `${name} ${id} mouse press`);
    await page.mouse.up();
    await page.mouse.move(0,0);
    await page.locator('#before').focus();
    await page.keyboard.press('Tab');
    if(id==='compact') await page.keyboard.press('Tab');
    assert.equal(await card.evaluate(e => e===e.ownerDocument.activeElement),true);
    assert.equal(await card.evaluate(e => getComputedStyle(e).outlineWidth),'3px');
    await page.keyboard.down('Space');
    await page.waitForTimeout(220);
    assert.equal(await bg(card), 'rgb(23, 59, 43)', `${name} ${id} keyboard press`);
    assert.equal(await card.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
    await page.keyboard.up('Space');
    await card.evaluate(e=>e.setAttribute('aria-pressed','true'));
    await page.waitForTimeout(220);
    assert.equal(await bg(card),'rgb(23, 59, 43)', `${name} selected`);
    await card.evaluate(e=>e.removeAttribute('aria-pressed'));
  }
  const readonly=page.locator('#readonly > div');
  const resting=await bg(readonly);
  await readonly.hover(); await page.waitForTimeout(220);
  assert.equal(await bg(readonly),resting,'read-only hover remains unchanged');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#full button').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  await page.locator('#full button').focus();
  await page.screenshot({path:`.validation/${name}-focus.png`,fullPage:true});
  const touch = await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});
  const mobile = await touch.newPage(); await mobile.setContent(document);
  assert.equal(await mobile.evaluate(()=>matchMedia('(hover: hover) and (pointer: fine)').matches),false);
  const touchCard=mobile.locator('#full button'); const normal=await bg(touchCard);
  await touchCard.tap(); await mobile.waitForTimeout(220);
  assert.equal(await bg(touchCard),normal,`${name} no sticky touch hover`);
  await mobile.screenshot({path:`.validation/${name}-touch.png`,fullPage:true});
  await touch.close(); await browser.close();
  console.log(`${name}: full/compact hover, press, keyboard focus, selected, read-only, reduced motion and touch checks passed`);
}
