/**
 * 入站媒体下载：把微信用户发来的图片/视频/文件/语音下载到本地 inbox，
 * 生成附加到 prompt 的中文标注文本。
 *
 * 单个媒体下载失败不会中断整条消息处理，而是降级为一条失败原因标注，
 * 让 OpenCode 仍能收到消息并提示用户重新发送。
 */
import type { DownloadedMedia } from "../api/media-download";
import type { IncomingMedia, IncomingMediaKind } from "../types/wechat";

/** 描述媒体类型的中文名，用于日志和标注。 */
export function describeMediaKind(kind: IncomingMediaKind): string {
  switch (kind) {
    case "image":
      return "图片";
    case "video":
      return "视频";
    case "file":
      return "文件";
    case "voice":
      return "语音";
  }
}

export type DownloadMediaDeps = {
  readonly downloadIncomingMedia: (
    media: IncomingMedia,
    options: {
      readonly cdnBaseUrl: string;
      readonly inboxDir: string;
    },
  ) => Promise<DownloadedMedia>;
};

/**
 * 下载一批入站媒体并为每个生成中文标注。
 *
 * @param logInfo  成功日志回调
 * @param logError 失败日志回调
 */
export async function downloadMediaAnnotations(
  media: readonly IncomingMedia[],
  deps: DownloadMediaDeps,
  options: {
    readonly cdnBaseUrl: string;
    readonly inboxDir: string;
    readonly logInfo: (msg: string) => void;
    readonly logError: (msg: string) => void;
  },
): Promise<string[]> {
  const annotations: string[] = [];
  for (const item of media) {
    const label = item.fileName
      ? `${describeMediaKind(item.kind)} "${item.fileName}"`
      : describeMediaKind(item.kind);
    try {
      const downloaded = await deps.downloadIncomingMedia(item, {
        cdnBaseUrl: options.cdnBaseUrl,
        inboxDir: options.inboxDir,
      });
      options.logInfo(
        `已下载${label}: ${downloaded.savedPath} (${downloaded.byteLength} bytes)`,
      );
      annotations.push(
        `[用户通过微信发送了${label}，已保存到本地路径: ${downloaded.savedPath}]`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      options.logError(`下载${label}失败: ${reason}`);
      annotations.push(
        `[用户通过微信发送了${label}，但下载失败，请告知用户重新发送。失败原因: ${reason}]`,
      );
    }
  }
  return annotations;
}
