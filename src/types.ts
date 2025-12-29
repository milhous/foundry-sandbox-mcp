/**
 * 类型定义
 */

export interface ForgeCommand {
  command: string;
  args?: string[];
  workingDir?: string;
}

export interface ForgeResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  image: string;
}

export interface CreateContainerOptions {
  image?: string;
  name?: string;
  workingDir?: string;
  volumes?: Record<string, string>;
}
