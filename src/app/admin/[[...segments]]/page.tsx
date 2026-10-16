import type { Metadata } from "next";

import { generatePageMetadata, RootPage } from "@payloadcms/next/views";
import configPromise from "@payload-config";

import { importMap } from "../importMap";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const generateMetadata = (args: Args): Promise<Metadata> =>
  generatePageMetadata({ ...args, config: configPromise });

/** Payload Admin UI 挂载点（/admin 全部段位交给 Payload 路由）。 */
export default function PayloadAdminPage(args: Args) {
  return RootPage({ ...args, config: configPromise, importMap });
}
