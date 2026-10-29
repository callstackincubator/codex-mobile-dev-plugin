import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const loader = docsLoader();
const schema = docsSchema();
const docs = defineCollection({ loader, schema });
export const collections = { docs };
