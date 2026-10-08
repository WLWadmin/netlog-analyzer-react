import { readFileSync } from 'fs';
import path from 'path';

const workflowPath = path.join(process.cwd(), '.github/workflows/deploy.yml');

describe('GitHub Pages diagnosis release gate', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  it('runs the required diagnosis suite before producing the Pages build', () => {
    const gateStart = workflow.indexOf('- name: Diagnosis release gate');
    const buildStart = workflow.indexOf('- name: Build');

    expect(gateStart).toBeGreaterThanOrEqual(0);
    expect(buildStart).toBeGreaterThan(gateStart);
    const gate = workflow.slice(gateStart, buildStart);
    expect(gate).toContain('CI=true npm test -- --watchAll=false --runInBand');
    expect(gate).not.toContain('--runTestsByPath');
    expect(gate).not.toMatch(/continue-on-error\s*:/);
  });

  it('does not let artifact upload or deployment bypass a failed build job', () => {
    const artifactStart = workflow.indexOf('- name: Upload artifact');
    const deployStart = workflow.indexOf('- name: Deploy to GitHub Pages');

    expect(artifactStart).toBeGreaterThan(workflow.indexOf('- name: Build'));
    expect(deployStart).toBeGreaterThan(artifactStart);
    expect(workflow).not.toMatch(/continue-on-error\s*:\s*true/);
    expect(workflow).not.toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/);
    expect(workflow).toMatch(/deploy:\s*[\s\S]*?needs:\s*build/);
  });
});
