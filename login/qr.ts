import { fetchQRCode, pollQRStatus } from "../api/ilink";
import { saveCredentials } from "../storage/credentials";
import { DEFAULT_BASE_URL, QR_LOGIN_DEADLINE_MS } from "../config";
import type { AccountData, QRStatusResponse } from "../types/wechat";

function log(msg: string) {
  process.stderr.write(`[qr-login] ${msg}\n`);
}

async function displayQR(qrcodeImgContent: string): Promise<void> {
  try {
    const qrterm = await import("qrcode-terminal");
    await new Promise<void>((resolve) => {
      qrterm.default.generate(qrcodeImgContent, { small: true }, (qr: string) => {
        process.stderr.write(qr + "\n");
        resolve();
      });
    });
  } catch {
    log(`QR 链接: ${qrcodeImgContent}`);
  }
}

export async function doQRLogin(baseUrl?: string): Promise<AccountData | null> {
  const targetBaseUrl = baseUrl ?? DEFAULT_BASE_URL;
  log("正在获取微信登录二维码...");

  const qrResp = await fetchQRCode(targetBaseUrl);
  log("\n请使用微信扫描以下二维码：\n");
  await displayQR(qrResp.qrcode_img_content);
  log("等待扫码...");

  const deadline = Date.now() + QR_LOGIN_DEADLINE_MS;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(targetBaseUrl, qrResp.qrcode);

    switch (status.status) {
      case "wait":
        break;
      case "scaned":
        if (!scannedPrinted) {
          log("已扫码，请在微信中确认...");
          scannedPrinted = true;
        }
        break;
      case "expired":
        log("二维码已过期，请重新启动。");
        return null;
      case "confirmed":
        return confirmLogin(status, targetBaseUrl);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  log("登录超时");
  return null;
}

/**
 * 从已确认的扫码状态构造账号数据（不落盘）。GUI 和终端登录共用。
 */
export function buildAccountFromStatus(
  status: QRStatusResponse,
  baseUrl: string,
): AccountData | null {
  if (!status.ilink_bot_id || !status.bot_token) {
    return null;
  }

  return {
    token: status.bot_token,
    baseUrl: status.baseurl || baseUrl,
    accountId: status.ilink_bot_id,
    userId: status.ilink_user_id,
    savedAt: new Date().toISOString(),
  };
}

function confirmLogin(
  status: QRStatusResponse,
  baseUrl: string,
): AccountData | null {
  const account = buildAccountFromStatus(status, baseUrl);
  if (!account) {
    log("登录确认但未返回 bot 信息");
    return null;
  }

  saveCredentials(account);
  log("微信连接成功！");
  return account;
}
