/**
 * Foundry 配置解析模块
 *
 * 负责解析 foundry.toml 配置文件，提取项目配置信息
 */

import * as toml from "@iarna/toml";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

/**
 * Foundry 配置接口
 */
export interface FoundryConfig {
  /** 项目根目录（foundry.toml 所在目录） */
  projectRoot: string;
  /** 源文件路径（相对于项目根目录） */
  src: string;
  /** 输出路径（相对于项目根目录） */
  out: string;
  /** 缓存路径（相对于项目根目录） */
  cachePath: string;
  /** 库路径数组（相对于项目根目录） */
  libs: string[];
  /** 其他配置项 */
  [key: string]: unknown;
}

/**
 * 解析 foundry.toml 配置文件
 *
 * @param foundryTomlPath - foundry.toml 文件的绝对路径
 * @returns 解析后的配置对象
 * @throws 如果文件不存在或解析失败
 */
export function parseFoundryToml(foundryTomlPath: string): FoundryConfig {
  // 验证文件存在
  if (!existsSync(foundryTomlPath)) {
    throw new Error(`foundry.toml file not found at: ${foundryTomlPath}`);
  }

  // 验证文件名
  const fileName = foundryTomlPath.split("/").pop() || foundryTomlPath.split("\\").pop();
  if (fileName !== "foundry.toml") {
    throw new Error(`Invalid file name: expected 'foundry.toml', got '${fileName}'`);
  }

  // 获取项目根目录
  const projectRoot = dirname(resolve(foundryTomlPath));

  try {
    // 读取并解析 TOML 文件
    const fileContent = readFileSync(foundryTomlPath, "utf-8");
    const parsed = toml.parse(fileContent) as Record<string, unknown>;

    // 提取 profile.default 配置
    const profileDefault = (
      parsed["profile.default"] ||
      (parsed.profile as Record<string, unknown>)?.default ||
      {}
    ) as Record<string, unknown>;

    // 提取配置项，使用默认值
    const src = (profileDefault.src as string) || "src";
    const out = (profileDefault.out as string) || "out";
    const cachePath = (profileDefault.cache_path as string) || "cache";
    const libs = Array.isArray(profileDefault.libs)
      ? (profileDefault.libs as string[])
      : typeof profileDefault.libs === "string"
      ? [profileDefault.libs]
      : ["lib"];

    return {
      projectRoot,
      src,
      out,
      cachePath,
      libs,
      ...parsed, // 保留其他配置项
    };
  } catch (error) {
    throw new Error(
      `Failed to parse foundry.toml: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 验证 foundry.toml 文件路径
 *
 * @param foundryTomlPath - foundry.toml 文件的路径
 * @returns 验证后的绝对路径
 * @throws 如果路径无效
 */
export function validateFoundryTomlPath(foundryTomlPath: string): string {
  if (!foundryTomlPath || foundryTomlPath.trim() === "") {
    throw new Error("foundryTomlPath is required");
  }

  const resolvedPath = resolve(foundryTomlPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`foundry.toml file not found at: ${resolvedPath}`);
  }

  return resolvedPath;
}

