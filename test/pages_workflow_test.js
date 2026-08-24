'use strict';

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'pages.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

function requireMatch(pattern, description) {
  if (!pattern.test(workflow)) {
    throw new Error(`Pages workflow contract missing: ${description}`);
  }
}

function rejectMatch(pattern, description) {
  if (pattern.test(workflow)) {
    throw new Error(`Pages workflow contract violated: ${description}`);
  }
}

const triggerBlock = workflow.match(/^on:\n([\s\S]*?)\n(?:permissions|jobs):/m);
if (!triggerBlock) {
  throw new Error('Pages workflow contract missing: top-level trigger block');
}

const expectedTrigger = [
  '  workflow_run:',
  '    workflows: [CI]',
  '    types: [completed]',
  '    branches: [main]',
].join('\n');
if (triggerBlock[1].trimEnd() !== expectedTrigger) {
  throw new Error('Pages workflow contract violated: workflow_run must be the only trigger');
}

for (const condition of [
  "github.event.workflow_run.name == 'CI'",
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_branch == 'main'",
  'github.event.workflow_run.head_repository.full_name == github.repository',
  'github.event.workflow_run.head_sha == github.sha',
]) {
  if (!workflow.includes(condition)) {
    throw new Error(`Pages workflow contract missing: trusted-run condition ${condition}`);
  }
}

requireMatch(/^permissions: \{\}$/m, 'deny-by-default workflow permissions');
requireMatch(
  /^    permissions:\n      contents: read\n      pages: write\n      id-token: write$/m,
  'minimal deployment job permissions',
);
requireMatch(
  /^    concurrency:\n      group: pages-production\n      cancel-in-progress: false$/m,
  'non-cancelling production deployment concurrency',
);

requireMatch(/uses: actions\/checkout@v7/, 'Node 24 checkout action');
requireMatch(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/, 'exact CI head SHA checkout');
requireMatch(/persist-credentials: false/, 'checkout credentials disabled after fetch');
requireMatch(/EXPECTED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/, 'expected SHA binding');
requireMatch(/test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_SHA"/, 'post-checkout SHA verification');
requireMatch(/uses: actions\/configure-pages@v6/, 'Node 24 Pages configuration action');
requireMatch(/uses: actions\/upload-pages-artifact@v5/, 'current Pages artifact action');
requireMatch(/uses: actions\/deploy-pages@v5/, 'Node 24 Pages deployment action');

rejectMatch(/enablement:\s*true/, 'deployment token attempts repository-wide Pages enablement');

console.log('PAGES-WORKFLOW-PASS');
