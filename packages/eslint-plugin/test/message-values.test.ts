import { describe, expect, it } from 'vitest';
import { translatePluginMessage } from '../src/localization.js';

describe('localized diagnostic values', () => {
  const advice = 'src/theme.css에 선언된 토큰을 사용하세요. 사용 가능한 예: bg-brand.';
  it('keeps an inline color separate from already translated advice', () => {
    const value = JSON.stringify('rgba(255, 0, 0, 0.5)');
    expect(translatePluginMessage(`Inline "color" hardcodes color ${value}. ${advice}`, 'ko'))
      .toBe(`인라인 "color"에 색상 ${value}을(를) 직접 지정했습니다. ${advice}`);
  });
  it('localizes ordinary CSS properties and SVG color attributes', () => {
    expect(translatePluginMessage(`Local CSS color hardcodes "red". ${advice}`, 'ko'))
      .toBe(`로컬 CSS color에 "red"을(를) 직접 지정했습니다. ${advice}`);
    expect(translatePluginMessage(`fill="red" hardcodes a color. Use currentColor or a declared --color-* variable. ${advice}`, 'ko'))
      .toContain(`fill="red"에 색상을 직접 지정했습니다.`);
  });
  it('preserves quoted module paths containing template separator words', () => {
    const from = JSON.stringify('src/from to quoted "name".ts'), to = JSON.stringify('src/to to other.ts');
    expect(translatePluginMessage(`Import from ${from} to ${to} violates the dependency boundary.`, 'ko'))
      .toBe(`${from}에서 ${to}(으)로의 import가 의존성 경계를 위반합니다.`);
    const name = JSON.stringify('api from name'), module = JSON.stringify('module from value');
    expect(translatePluginMessage(`Using ${name} from ${module} is forbidden.`, 'ko'))
      .toBe(`${module}의 ${name}을(를) 사용할 수 없습니다.`);
  });
});
