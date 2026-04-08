import fs from "fs"

const files = [
  'packages/opencode/src/agent/agent.ts',
  'packages/opencode/src/session/index.ts',
  'packages/opencode/src/session/llm.ts',
  'packages/opencode/src/session/processor.ts',
  'packages/opencode/src/session/prompt.ts',
  'packages/opencode/src/session/session.sql.ts',
  'packages/opencode/src/server/routes/session.ts',
  'packages/opencode/src/tool/tool.ts',
  'packages/opencode/src/tool/skill.ts',
  'packages/opencode/src/tool/task.ts',
  'packages/opencode/src/tool/bash.ts',
  'packages/opencode/src/tool/truncation.ts',
  'packages/opencode/test/agent/agent.test.ts',
  'packages/opencode/test/agent/execute-agent.test.ts',
  'packages/opencode/test/tool/bash.test.ts',
  'packages/opencode/test/tool/external-directory.test.ts',
  'packages/opencode/test/tool/read.test.ts',
  'packages/opencode/test/tool/skill.test.ts'
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/import\s+(type\s+)?\{\s*PermissionNext\s*\}\s*from\s*['"][^'"]+['"];?\r?\n?/g, '');
  c = c.replace(/import\s+(type\s+)?\{\s*BashArity\s*\}\s*from\s*['"][^'"]+['"];?\r?\n?/g, '');
  
  // Specific file fixes:
  if (f.includes('tool.ts')) {
    c = c.replace(/\s*ask\(input:\s*Omit<PermissionNext\.Request.*?Promise<void>;?/s, '');
  }
  
  if (f.includes('bash.ts') || f.includes('task.ts') || f.includes('read.ts') || f.includes('external-directory.ts') || f.includes('skill.ts')) {
    c = c.replace(/\s*await\s+ctx\.ask\(\{\s*(?:permission:.*?)[^}]+\}\);?/gs, '');
    c = c.replace(/\s*const patterns = new Set<string>\(\)/g, '');
    c = c.replace(/\s*const always = new Set<string>\(\)/g, '');
    // remove BashArity usage
    c = c.replace(/\s*always\.add\(BashArity\.prefix.*?;/g, '');
    c = c.replace(/\s*patterns\.add\(.*?;/g, '');
    c = c.replace(/\s*if\s*\(patterns\.size\s*>\s*0\)\s*\{[^\}]+\}/g, '');
    c = c.replace(/\s*if\s*\(directories\.size\s*>\s*0\)\s*\{[^\}]+\}/g, '');
  }
  
  fs.writeFileSync(f, c);
}
console.log("Stripped imports via regex.");
