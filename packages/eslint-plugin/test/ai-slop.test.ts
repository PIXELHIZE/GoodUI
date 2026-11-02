import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ESLint } from 'eslint';
import { AI_SLOP_RULE_NAMES, getAiSlopRuleCatalog, type AiSlopPolicy, type AiSlopRuleName, type Policy } from '@pixelhize/goodui-core';
import { createConfig, lintProject } from '../src/index.js';

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });
function policyFor(rule: AiSlopRuleName, settings: AiSlopPolicy = {}): Policy {
  return { version: 1, rules: [], aiSlop: { enabled: true, rules: Object.fromEntries(AI_SLOP_RULE_NAMES.map(name => [name, name === rule])), ...settings } };
}
async function fixture(source: string, extension = 'tsx', path = `src/page.${extension}`): Promise<{rootDir:string;path:string}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'goodui-ai-slop-'));
  roots.push(rootDir);
  await mkdir(dirname(join(rootDir, path)), { recursive: true });
  await writeFile(join(rootDir, path), source);
  return { rootDir, path };
}
function ui(markup: string, extension = 'tsx'): string { return extension === 'tsx' ? `const page=(${markup});` : extension === 'vue' ? `<template>${markup}</template>` : markup; }
async function check(rule: AiSlopRuleName, markup: string, extension = 'tsx', settings: AiSlopPolicy = {}, raw = false) {
  const {rootDir,path} = await fixture(raw ? markup : ui(markup, extension), extension);
  return lintProject({rootDir,files:[path],policy:policyFor(rule,settings),locale:'en'});
}

const positives: [AiSlopRuleName,string][] = [
  ['no-gradient-text','<h1 className="bg-gradient-to-r from-blue-500 to-red-500 bg-clip-text text-transparent">Title</h1>'],
  ['no-purple-gradients','<div className="bg-gradient-to-r from-purple-500 to-blue-600"/>'],
  ['no-glassmorphism','<div className="backdrop-blur-md bg-white/10"/>'],
  ['no-decorative-blobs','<div className="absolute w-64 h-64 rounded-full blur-3xl bg-purple-400 pointer-events-none"/>'],
  ['no-hover-lift','<button className="hover:-translate-y-1">Save</button>'],
  ['no-bounce-animation','<span className="animate-bounce">Item</span>'],
  ['no-emoji-icons','<h1>🚀 Launch</h1>'],
  ['no-generic-copy','<h1>Unlock your potential</h1>'],
  ['no-placeholder-copy','<p>Lorem ipsum dolor sit amet</p>'],
  ['no-placeholder-links','<a href="#">Read more</a>'],
  ['no-nested-cards','<Card><div><Card>Body</Card></div></Card>'],
  ['no-oversized-radius','<div className="rounded-3xl">Body</div>'],
  ['no-generic-fonts','<p className="font-[Inter]">Body</p>'],
];

describe('AI-slop factory and diagnostic integration', () => {
  it.each(positives)('checks %s without a Tailwind project and preserves KO/EN machine data', async (rule, markup) => {
    const {rootDir,path} = await fixture(ui(markup));
    const note='USER_NOTE unchanged';
    const policy=policyFor(rule,{note});
    const before=JSON.stringify(policy);
    const [en,ko]=await Promise.all([lintProject({rootDir,files:[path],policy,locale:'en'}),lintProject({rootDir,files:[path],policy,locale:'ko'})]);
    expect(en.errorCount).toBeGreaterThan(0);
    expect(ko.errorCount).toBe(en.errorCount);
    expect(en.diagnostics.every(item=>item.ruleId===`goodui/${rule}`&&item.policyId==='ai-slop'&&item.line>0&&item.column>0)).toBe(true);
    const entry=getAiSlopRuleCatalog('ko').find(item=>item.name===rule)!;
    for(const item of ko.diagnostics){expect(item.reason).toBe(entry.reason);expect(item.suggestion).toBe(entry.suggestion);expect(item.message).toMatch(/[가-힣]/);expect(item.message.endsWith(note)).toBe(true);}
    expect(ko.diagnostics.map(({message,reason,suggestion,...rest})=>rest)).toEqual(en.diagnostics.map(({message,reason,suggestion,...rest})=>rest));
    expect(JSON.stringify(policy)).toBe(before);
  });

  it.each(['vue','svelte'])('runs the six style checks in %s templates', async extension=>{
    for(const [rule,markup] of positives.slice(0,6)){
      const report=await check(rule,markup.replaceAll('className=','class='),extension);
      expect(report.diagnostics.some(item=>item.ruleId===`goodui/${rule}`)).toBe(true);
      expect(report.diagnostics.every(item=>item.ruleId!==null)).toBe(true);
    }
  });

  it('is inactive for old policies and respects explicit group disable over a preset',async()=>{
    const {rootDir,path}=await fixture(ui(positives[0]![1]));
    const ordinary:Policy={version:1,rules:[{id:'eval',kind:'restricted-api',globals:['eval'],reason:'Existing policy'}]};
    expect((await lintProject({rootDir,policy:ordinary})).errorCount).toBe(0);
    const disabled:Policy={...ordinary,presets:['ai-slop'],aiSlop:{enabled:false}};
    expect((await lintProject({rootDir,policy:disabled})).errorCount).toBe(0);
    const onlyOne=policyFor('no-bounce-animation');
    expect((await lintProject({rootDir,policy:onlyOne,files:[path]})).errorCount).toBe(0);
  });

  it('scopes group files/ignores and central exceptions without weakening unrelated contracts',async()=>{
    const {rootDir,path}=await fixture(ui('<div className="animate-bounce"/>'));
    const policy:Policy={...policyFor('no-bounce-animation'),rules:[{id:'eval',kind:'restricted-api',globals:['eval'],reason:'No eval'}]};
    expect((await lintProject({rootDir,policy:{...policy,aiSlop:{...policy.aiSlop,files:['other/**']}}})).errorCount).toBe(0);
    expect((await lintProject({rootDir,policy:{...policy,aiSlop:{...policy.aiSlop,ignores:['src/**']}}})).errorCount).toBe(0);
    const exception:Policy={...policy,exceptions:[{ruleId:'goodui/no-bounce-animation',files:[path],reason:'USER_EXCEPTION unchanged'}]};
    expect((await lintProject({rootDir,policy:exception})).errorCount).toBe(0);
    await writeFile(join(rootDir,path),'eval("x");');
    expect((await lintProject({rootDir,policy:exception})).diagnostics[0]?.ruleId).toBe('goodui/restricted-api');
  });

  it('keeps the ai-slop group identity separate from an ordinary rule with that same user ID',async()=>{
    const {rootDir}=await fixture('eval("x");'+ui('<div className="animate-bounce"/>'));
    const policy:Policy={...policyFor('no-bounce-animation'),rules:[{id:'ai-slop',kind:'restricted-api',globals:['eval'],reason:'USER_REASON',suggestion:'USER_SUGGESTION'}]};
    const report=await lintProject({rootDir,policy,locale:'en'});
    expect(report.diagnostics.find(item=>item.ruleId==='goodui/restricted-api')?.reason).toBe('USER_REASON');
    expect(report.diagnostics.find(item=>item.ruleId==='goodui/no-bounce-animation')?.reason).toBe(getAiSlopRuleCatalog('en').find(item=>item.name==='no-bounce-animation')!.reason);
  });

  it('uses the same messages in direct linting and generated ESLint config and ignores inline disables',async()=>{
    const {rootDir,path}=await fixture('/* eslint-disable goodui/no-bounce-animation */\n'+ui('<div className="animate-bounce"/>'));
    const policy=policyFor('no-bounce-animation');
    const direct=await lintProject({rootDir,policy,locale:'ko'});
    const eslint=new ESLint({cwd:rootDir,overrideConfigFile:true,overrideConfig:await createConfig({rootDir,policy,locale:'ko'})});
    const [editor]=await eslint.lintFiles([path]);
    expect(direct.errorCount).toBe(1);
    expect(direct.diagnostics.find(item=>item.ruleId==='goodui/no-bounce-animation')?.message).toBe(editor!.messages.find(item=>item.ruleId==='goodui/no-bounce-animation')?.message);
  });
});

describe('conservative style evidence',()=>{
  it.each([
    ['no-gradient-text','<h1 className="text-transparent bg-clip-text">Title</h1>'],
    ['no-purple-gradients','<div className="bg-indigo-500"/>'],
    ['no-glassmorphism','<div className="backdrop-blur-md bg-white"/>'],
    ['no-decorative-blobs','<div className="rounded-full bg-purple-500">Avatar</div>'],
    ['no-hover-lift','<button className="focus:-translate-y-1 hover:translate-y-1 scale-105 hover:scale-95 hover:scale-100">Save</button>'],
    ['no-bounce-animation','<span className="animate-pulse">Loading</span>'],
  ] as const)('does not infer %s from unrelated single features',async(rule,markup)=>{expect((await check(rule,markup)).errorCount).toBe(0);});

  it('does not combine mutually exclusive complete class strings',async()=>{
    const source="declare const active:boolean; const page=<h1 className={active?'bg-gradient-to-r':'bg-clip-text text-transparent'}/>;";
    expect((await check('no-gradient-text',source,'tsx',{},true)).errorCount).toBe(0);
    const positive="import {clsx as cx} from 'clsx'; const page=<h1 className={cx('bg-gradient-to-r','bg-clip-text','text-transparent')}/>;";
    expect((await check('no-gradient-text',positive,'tsx',{},true)).errorCount).toBe(1);
  });

  it('supports class allow lists, indigo stops, fractional lift and arbitrary bounce syntax',async()=>{
    expect((await check('no-gradient-text',positives[0]![1],'tsx',{allowClasses:['bg-gradient-to-*']})).errorCount).toBe(0);
    expect((await check('no-purple-gradients','<div className="bg-gradient-to-r from-indigo-500 to-blue-600"/>')).errorCount).toBe(1);
    expect((await check('no-hover-lift','<button className="hover:-translate-y-0.5">Save</button>')).errorCount).toBe(1);
    expect((await check('no-hover-lift','<button className="hover:-translate-y-0 hover:translate-y-[-0px]">Save</button>')).errorCount).toBe(0);
    expect((await check('no-bounce-animation','<div className="animate-[bounce_1s_infinite]"/>')).errorCount).toBe(1);
  });

  it.each(['hover:scale-105','md:hover:scale-[1.1]','hover:scale-[105%]','[&:hover]:scale-105'])('reports explicit hover enlargement %s',async token=>{
    expect((await check('no-hover-lift',`<button className="${token}">Save</button>`)).errorCount).toBe(1);
  });

  it.each(['hover:scale-95','hover:scale-100','hover:scale-[1]','hover:scale-[100%]','hover:scale-[var(--factor)]','scale-105','[&:not(:hover)]:-translate-y-1','[&:not(:hover)]:scale-105'])('does not infer hover enlargement from %s',async token=>{
    expect((await check('no-hover-lift',`<button className="${token}">Save</button>`)).errorCount).toBe(0);
  });

  it('checks literal inline style combinations while leaving opaque RGB backgrounds alone',async()=>{
    expect((await check('no-gradient-text',`<h1 style={{backgroundImage:'linear-gradient(red,blue)',backgroundClip:'text',color:'transparent'}}>Title</h1>`)).errorCount).toBe(1);
    expect((await check('no-purple-gradients',`<div style={{background:'linear-gradient(purple,blue)'}}/>`)).errorCount).toBe(1);
    expect((await check('no-glassmorphism',`<div style={{backdropFilter:'blur(12px)',backgroundColor:'rgba(255,255,255,0.1)'}}/>`)).errorCount).toBe(1);
    expect((await check('no-glassmorphism',`<div style={{backdropFilter:'blur(12px)',backgroundColor:'rgb(255,255,0.5)'}}/>`)).errorCount).toBe(0);
    expect((await check('no-bounce-animation',`<div style={{animation:'bounce 1s infinite'}}/>`)).errorCount).toBe(1);
  });

  it.each(['vue','svelte'])('checks local %s style blocks and excludes negated hover selectors',async extension=>{
    const markup=extension==='vue'?'<template><button>Save</button></template>':'<button>Save</button>';
    const css='.button:hover { transform: translateY(-4px); }';
    expect((await check('no-hover-lift',`${markup}<style>${css}</style>`,extension,{},true)).errorCount).toBe(1);
    const noHover='.button:not(:hover){transform:translateY(-4px)} .other:not(:hover){transform:scale(1.1)}';
    expect((await check('no-hover-lift',`${markup}<style>${noHover}</style>`,extension,{},true)).errorCount).toBe(0);
    expect((await check('no-bounce-animation',`${markup}<style>.dot{animation:bounce 1s infinite}</style>`,extension,{},true)).errorCount).toBe(1);
    expect((await check('no-glassmorphism',`${markup}<style>.glass{backdrop-filter:blur(8px);background:rgba(255,255,255,.1)}</style>`,extension,{},true)).errorCount).toBe(1);
    expect((await check('no-hover-lift',`${markup}<style>.button:hover{transform:scale(1.1)}</style>`,extension,{},true)).errorCount).toBe(1);
    expect((await check('no-hover-lift',`${markup}<style>.button:hover{transform:scale(.95)} .other:hover{transform:scale(1)} .unknown:hover{transform:scale(var(--factor))} .plain{transform:scale(1.1)}</style>`,extension,{},true)).errorCount).toBe(0);
  });
});
