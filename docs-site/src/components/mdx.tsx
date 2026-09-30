/**
 * mdx 里能用的 React 组件表。机读规则表在 docfirst.config.mjs，两边的名单由 registry.ts 的类型对齐：
 * 少一个编译不过，多一个也编译不过；两边的组件名是否一致由 scripts/verify-roster.mjs 核对。
 * 先放 fumadocs 的默认组件表，再把 pre 换成 @godcreator/docfirst-workflow/fumadocs/pre 里会画状态点的 DocfirstPre。
 */
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import { DocfirstPre } from '@godcreator/docfirst-workflow/fumadocs/pre';
import { GiteaSeams } from './gitea-seams';
import type { ComponentName } from './registry';

export function Note({ children }: { children?: ReactNode }) {
  return <div className="note">{children}</div>;
}

const table: Record<ComponentName, MDXComponents[string]> = {
  Note,
  Files,
  Folder,
  File,
  GiteaSeams,
};

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ...components,
    ...table,
    pre: DocfirstPre,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
