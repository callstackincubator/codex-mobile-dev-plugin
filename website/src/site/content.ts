import type { IconName } from '../components/site/icons';

const localOrigin = 'http://localhost:4321';
const isVercelBuild = process.env.VERCEL === '1';
const buildOrigin = isVercelBuild ? `https://${process.env.VERCEL_URL}` : localOrigin;
export const site = {
  name: 'Mobile Dev',
  wordmark: 'Mobile Dev',
  url: process.env.SITE_URL ?? buildOrigin,
  repo: 'https://github.com/callstackincubator/mobile-dev',
  subtitle: 'Mobile development in your ADE',
  headline: ['Mobile development.', 'In your ADE.'],
  lede: 'A plugin for mobile development in your ADE. Bring your running app, devices, logs, performance, and storage into Codex, Claude, Cursor, and more.',
  description: 'A plugin for mobile development in your ADE. Run, inspect, and debug iOS and Android apps inside Codex, Claude, Cursor, and more.',
  install: 'codex plugin add mobile-dev@mobile-dev',
  skill: undefined as string | undefined,
  ogAlt: 'Mobile Dev by Callstack. Mobile development in your ADE. A coding conversation and a running phone app share one workspace.',
  owner: 'Callstack',
  callstack: 'https://callstack.com/?utm_source=mobile-dev&utm_medium=referral',
  license: {
    name: 'MIT',
    url: 'https://github.com/callstackincubator/mobile-dev/blob/main/LICENSE',
    spdx: 'https://opensource.org/licenses/MIT',
  },
  platforms: ['iOS', 'Android'],
  language: 'TypeScript',
  mark: undefined as string[] | undefined,
};

export const docs = {
  intro: '/docs/introduction',
  start: '/docs/getting-started',
  devices: '/docs/devices',
  control: '/docs/app-control',
  logs: '/docs/logs',
  performance: '/docs/performance',
  profiles: '/docs/profiles',
  storage: '/docs/storage',
  privacy: '/docs/privacy',
  terms: '/docs/terms',
  llms: '/llms.txt',
};

export const pluginStoreUrl = 'https://chatgpt.com/plugins/plugins_6ac4c117f76881918d3676e851fa4005';
export const installOptions = [
  { name: 'ChatGPT / Codex', detail: 'Open the ChatGPT plugin store.', href: pluginStoreUrl, external: true },
  { name: 'Claude', detail: 'Manual setup for Desktop and Claude Code.', href: `${docs.start}#claude`, external: false },
  { name: 'Cursor', detail: 'Manual setup for the local Cursor plugin.', href: `${docs.start}#cursor`, external: false },
];

type Link = { text: string; href: string };
export const nav: Link[] = [
  { text: 'Workflow', href: '/#workflow' },
  { text: 'Docs', href: docs.intro },
  { text: 'GitHub', href: site.repo },
];
export const footer: Link[] = [
  { text: 'Docs', href: docs.intro },
  { text: 'GitHub', href: site.repo },
  { text: 'MIT license', href: site.license.url },
  { text: 'Privacy', href: docs.privacy },
  { text: 'Terms', href: docs.terms },
  { text: 'Callstack', href: site.callstack },
];
export const noindexPaths = ['/404'];
export const marquee = ['Codex', 'Claude', 'Cursor', 'iOS', 'Android', 'Expo', 'React Native', 'SwiftUI'];
export const notFound = ['This workspace is empty.', 'Your app is one click away.'];
export const environments = [
  { name: 'Codex', detail: 'Install from the plugin directory.', status: 'Plugin directory', href: pluginStoreUrl },
  { name: 'Claude', detail: 'A Desktop extension and a Code plugin.', status: 'Manual installation', href: '/docs/getting-started#claude' },
  { name: 'Cursor', detail: 'A local plugin for your agent workspace.', status: 'Manual installation', href: '/docs/getting-started#cursor' },
  { name: 'Other ADEs', detail: 'Connect the MCP server in a compatible client.', status: 'MCP connection', href: '/docs/getting-started#other-environments' },
];
export const faq = [
  { q: 'Which environments can I use?', a: 'Codex, Claude, and Cursor have host packages. Other compatible MCP clients can connect to the server; embedded device panels require MCP Apps support.' },
  { q: 'Is this only for React Native?', a: 'No. Use Mobile Dev with Expo, React Native, SwiftUI, and other native mobile apps. React Native inspection connects to an existing Metro server.' },
  { q: 'Can I use a real phone?', a: 'Yes. Connect iPhones and iPads through Xcode, or Android devices through authorized USB or wireless debugging. Available controls depend on the platform and device.' },
  { q: 'What do I need installed?', a: 'An Apple Silicon Mac, plus Xcode for iOS or Android SDK tools for Android. iOS simulators need Xcode 26 or later; physical iOS discovery needs Xcode 27 or later.' },
  { q: 'Does Mobile Dev build my app?', a: 'Your agent uses the project’s existing build tools. Mobile Dev supplies the device view, app controls, inspection, logs, performance, and storage tools.' },
  { q: 'What telemetry is collected?', a: 'Plugin telemetry includes errors and aggregate plugin performance. App logs, screenshots, input, storage contents, and device recordings are excluded. Read the privacy guide for details and opt-out.' },
];

type Feature = { icon: IconName; title: string; body: string; href: string };
export const features: Feature[] = [
  { icon: 'code', title: 'Live devices', body: 'Keep iOS and Android beside your conversation, on simulators and connected phones.', href: docs.devices },
  { icon: 'search', title: 'Inspect and annotate', body: 'Select an element or a screen region and give your agent the context for the change.', href: docs.devices },
  { icon: 'signpost', title: 'App and device controls', body: 'Open deep links, set permissions, change appearance, and test slower networks.', href: docs.control },
  { icon: 'panel', title: 'Native and app logs', body: 'Follow iOS, Android, and Metro logs, then send the relevant error to your agent.', href: docs.logs },
  { icon: 'gauge', title: 'Performance recordings', body: 'Record CPU, memory, and supported device Display FPS over the interaction you want to understand.', href: docs.performance },
  { icon: 'flame', title: 'Profile analysis', body: 'Explore CPU and React profiles with TraceSift, and investigate selected frames with your agent.', href: docs.profiles },
  { icon: 'database', title: 'App storage', body: 'Inspect files, databases, and key-value stores. Watch changes while you use your app.', href: docs.storage },
  { icon: 'network', title: 'Your existing stack', body: 'Use your app’s own build tools with Expo, React Native, SwiftUI, and native projects.', href: docs.start },
];
export const home = {
  transcript: [
    { kind: 'cmd', text: 'Work on MOB-142.' },
    { kind: 'out', text: 'Opening the app beside this conversation.' },
    { kind: 'cmd', text: 'Change the title to My trips.' },
    { kind: 'ok', text: 'The updated app is ready to review.' },
  ],
};
