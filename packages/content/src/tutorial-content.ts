import manifest from './v0.1-content-manifest.json';
import { buildTutorialContent } from './content-registry';

export const tutorialContent = buildTutorialContent(manifest);
