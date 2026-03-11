import { ControllerModel } from './contracts';
import { quoteSingle, toSafeIdentifier } from './helpers';

// ────────────────────────────────────────────────────
// 辅助渲染函数
// ────────────────────────────────────────────────────

function renderGetwiLines(entries: string[], indent = ''): string {
  if (entries.length === 0) {
    return `${indent}<%_ /* no entries */ _%>\n`;
  }

  return entries.map(entry => `${indent}<%- await getwi(null, ${quoteSingle(entry)}) %>`).join('\n') + '\n';
}

/** 装饰器行（@@preprocessing 等），输出在模板最顶部 */
function renderDecorators(decorators: string[]): string {
  if (decorators.length === 0) return '';
  return decorators.join('\n') + '\n';
}

/** getvar 声明 */
function renderVariableDeclarations(model: ControllerModel): string {
  return model.variables
    .map(variable => {
      const identifier = toSafeIdentifier(variable.name);
      return `if (typeof ${identifier} === 'undefined') var ${identifier} = getvar(${quoteSingle(variable.path)}, { defaults: ${JSON.stringify(variable.default)} });`;
    })
    .join('\n');
}

/** setvar 调用 */
function renderSetVariables(model: ControllerModel): string {
  if (model.set_variables.length === 0) return '';
  return model.set_variables
    .map(sv => `setvar(${quoteSingle(sv.key)}, ${JSON.stringify(sv.value)}, { scope: ${quoteSingle(sv.scope)} });`)
    .join('\n');
}

/** 纯文本注入 */
function renderInjectText(model: ControllerModel): string {
  if (model.inject_text.length === 0) return '';
  return model.inject_text.join('\n') + '\n';
}

/** activewi 调用 */
function renderActivateEntries(model: ControllerModel): string {
  if (model.activate_entries.length === 0) return '';
  const lines = model.activate_entries.map(ae => {
    if (ae.world) {
      return `<%_ await activewi(${quoteSingle(ae.world)}, ${quoteSingle(ae.entry)}, true); _%>`;
    }
    return `<%_ await activewi(${quoteSingle(ae.entry)}, true); _%>`;
  });
  return lines.join('\n') + '\n';
}

/** 角色检测 + 动态加载 */
function renderCharDetection(model: ControllerModel, dynPrefix: string): string {
  const cd = model.char_detection;
  if (!cd) return '';

  const aliasMapJson = JSON.stringify(cd.alias_map);
  const patterns = cd.entry_patterns;
  const scanDepth = cd.scan_messages;

  let code = '<%\n';
  code += '// === EW 角色检测 ===\n';
  code += `var _ewDetected = new Set();\n`;
  code += `var _ewAliasMap = ${aliasMapJson};\n`;

  // 从变量提取在场角色
  if (cd.scene_var) {
    code += `var _ewScene = getvar(${quoteSingle(cd.scene_var)}, { defaults: {} });\n`;
    code += `if (_ewScene && typeof _ewScene === 'object') {\n`;
    code += `  for (var _k of Object.keys(_ewScene)) {\n`;
    code += `    _ewDetected.add(_ewAliasMap[_k] || _k);\n`;
    code += `  }\n`;
    code += `}\n`;
  }

  // 从消息文本扫描
  if (scanDepth > 0) {
    code += `var _ewMsgs = getChatMessages(-${scanDepth});\n`;
    code += `var _ewText = _ewMsgs.map(function(m){return m.message}).join('\\n');\n`;
    code += `for (var _alias of Object.keys(_ewAliasMap)) {\n`;
    code += `  if (_ewText.includes(_alias)) _ewDetected.add(_ewAliasMap[_alias]);\n`;
    code += `}\n`;
  }

  code += `var _ewChars = Array.from(_ewDetected);\n`;
  code += `%>\n\n`;

  // 循环加载条目
  code += `<% for (var _ewI = 0; _ewI < _ewChars.length; _ewI++) { %>\n`;
  for (const pattern of patterns) {
    // {name} → _ewChars[_ewI]
    // 构建动态 getwi 调用
    const prefix = quoteSingle(dynPrefix);
    if (pattern === '{name}') {
      code += `<%- await getwi(null, ${prefix} + _ewChars[_ewI]) %>\n`;
    } else if (pattern.includes('{name}')) {
      const parts = pattern.split('{name}');
      const left = parts[0] || '';
      const right = parts.slice(1).join('{name}') || '';
      code += `<%- await getwi(null, ${prefix} + ${quoteSingle(left)} + _ewChars[_ewI] + ${quoteSingle(right)}) %>\n`;
    } else {
      // 没有 {name} 占位符，作为固定条目名
      code += `<%- await getwi(null, ${quoteSingle(dynPrefix + pattern)}) %>\n`;
    }
  }
  code += `<% } %>\n`;

  return code;
}

/** rules + fallback_entries 条件分支 */
function renderRulesAndFallback(model: ControllerModel): string {
  let body = '';
  if (model.rules.length === 0) {
    body += renderGetwiLines(model.fallback_entries);
  } else {
    model.rules.forEach((rule, index) => {
      const branch = index === 0 ? 'if' : 'else if';
      body += `<%_ ${branch} (${rule.when}) { _%>\n`;
      body += renderGetwiLines(rule.include_entries);
      body += `<%_ } `;

      if (index === model.rules.length - 1) {
        body += `else { _%>\n`;
        body += renderGetwiLines(model.fallback_entries);
        body += `<%_ } _%>\n`;
      } else {
        body += `_%>\n`;
      }
    });
  }
  return body;
}

// ────────────────────────────────────────────────────
// 校验
// ────────────────────────────────────────────────────

function fallbackSyntaxCheck(content: string) {
  const openCount = (content.match(/<%/g) ?? []).length;
  const closeCount = (content.match(/%>/g) ?? []).length;
  if (openCount === 0 && closeCount === 0) {
    // 纯文本模板（inject_text only）也是合法的
    return;
  }
  if (openCount !== closeCount) {
    throw new Error('EJS syntax check failed: tag count mismatch');
  }
}

export async function validateEjsTemplate(content: string): Promise<void> {
  const checker = _.get(window, 'EjsTemplate.getSyntaxErrorInfo') as
    | ((code: string, count: number) => Promise<string | null>)
    | undefined;
  if (typeof checker === 'function') {
    const error = await checker(content, 4);
    if (typeof error === 'string' && error.trim()) {
      throw new Error(`EJS syntax check failed: ${error}`);
    }
    return;
  }

  fallbackSyntaxCheck(content);
}

// ────────────────────────────────────────────────────
// 主渲染入口
// ────────────────────────────────────────────────────

export async function renderControllerTemplate(
  model: ControllerModel,
  dynPrefix: string = 'EW/Dyn/',
): Promise<string> {
  if (model.template_id !== 'entry_selector_v1') {
    throw new Error(`unsupported controller template: ${model.template_id}`);
  }

  const parts: string[] = [];

  // 1. 装饰器（最顶部）
  const decorators = renderDecorators(model.decorators);
  if (decorators) parts.push(decorators);

  // 2. 变量声明 + setvar（scriptlet 区）
  const declarations = renderVariableDeclarations(model);
  const setVars = renderSetVariables(model);
  const scriptlet = [declarations, setVars].filter(Boolean).join('\n');
  if (scriptlet) {
    parts.push(`<%_\n${scriptlet}\n_%>\n`);
  }

  // 3~6. body 内容
  let body = '';
  body += renderInjectText(model);
  body += renderActivateEntries(model);
  body += renderCharDetection(model, dynPrefix);
  body += renderRulesAndFallback(model);

  // skip_floor_zero 包裹
  if (model.skip_floor_zero) {
    const wrapped =
      `<%\nvar _ewFloorMsgs = getChatMessages(-1);\n` +
      `var _ewIsFloorZero = _ewFloorMsgs.length > 0 && _ewFloorMsgs[0].message_id === 0;\n` +
      `%>\n` +
      `<% if (!_ewIsFloorZero) { %>\n` +
      body +
      `<% } %>\n`;
    parts.push(wrapped);
  } else {
    parts.push(body);
  }

  const template = parts.join('\n');
  await validateEjsTemplate(template);
  return template;
}
