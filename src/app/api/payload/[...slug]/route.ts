import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from "@payloadcms/next/routes";
import configPromise from "@payload-config";

/**
 * Payload REST API（任务书：src/app/api/payload/[...slug]/route.ts）。
 * 挂在 /api/payload/*，与既有业务 /api/* 完全隔离；GraphQL 已在 config 关闭。
 */
export const GET = REST_GET(configPromise);
export const POST = REST_POST(configPromise);
export const DELETE = REST_DELETE(configPromise);
export const PATCH = REST_PATCH(configPromise);
export const PUT = REST_PUT(configPromise);
export const OPTIONS = REST_OPTIONS(configPromise);
