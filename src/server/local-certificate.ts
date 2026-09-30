import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export type CertificateStatus = { state: "ready" | "missing" | "untrusted" | "expired"; expiresAt?: string };
export type CertificateMaterial = { key: Buffer; cert: Buffer };
export interface LocalCertificate {
  status(): Promise<CertificateStatus>;
  material(): Promise<CertificateMaterial | undefined>;
  setup(): Promise<CertificateStatus>;
}

const execute = promisify(execFile);
const certificateName = "Mobile Dev local streaming";
const host = "127.0.0.1";
type CertificateCommand = (command: string, args: string[], timeout: number) => Promise<string>;

async function executeCommand(command: string, args: string[], timeout: number): Promise<string> {
  const { stdout } = await execute(command, args, { timeout, encoding: "utf8" });
  return stdout;
}

export class MacLocalCertificate implements LocalCertificate {
  private readonly directory: string;
  private readonly command: CertificateCommand;
  private settingUp?: Promise<CertificateStatus>;

  constructor(directory?: string, command: CertificateCommand = executeCommand) {
    const home = homedir();
    this.directory = directory ?? join(home, "Library", "Application Support", "Mobile Dev", "tls");
    this.command = command;
  }

  private async read(): Promise<CertificateMaterial | undefined> {
    try {
      const keyPath = join(this.directory, "localhost.key");
      const certificatePath = join(this.directory, "localhost.crt");
      const key = await readFile(keyPath);
      const cert = await readFile(certificatePath);
      return { key, cert };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  async status(): Promise<CertificateStatus> {
    const material = await this.read();
    if (material == null) return { state: "missing" };
    const certificate = new X509Certificate(material.cert);
    const expiresAt = certificate.validTo;
    const expiry = Date.parse(expiresAt);
    if (expiry <= Date.now()) return { state: "expired", expiresAt };
    const certificatePath = join(this.directory, "localhost.crt");
    try {
      await this.command("/usr/bin/security", ["verify-cert", "-c", certificatePath, "-p", "ssl", "-n", host, "-L", "-q"], 10000);
      const browserTrusted = await this.browserTrusted(certificate);
      if (browserTrusted === false) return { state: "untrusted", expiresAt };
      return { state: "ready", expiresAt };
    } catch { return { state: "untrusted", expiresAt }; }
  }

  private async browserTrusted(certificate: X509Certificate): Promise<boolean> {
    const temporaryRoot = tmpdir();
    const prefix = join(temporaryRoot, "mobile-dev-trust-");
    const temporary = await mkdtemp(prefix);
    try {
      const settings = join(temporary, "trust.plist");
      await this.command("/usr/bin/security", ["trust-settings-export", settings], 10000);
      const fingerprint = certificate.fingerprint.replaceAll(":", "");
      const key = `trustList.${fingerprint}.trustSettings`;
      const record = await this.command("/usr/bin/plutil", ["-extract", key, "xml1", "-o", "-", settings], 10000);
      // Chromium skips hostname- and application-scoped macOS trust entries.
      return record.includes("<key>kSecTrustSettingsPolicyString</key>") === false
        && record.includes("<key>kSecTrustSettingsApplication</key>") === false;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async material(): Promise<CertificateMaterial | undefined> {
    const status = await this.status();
    if (status.state === "ready") return this.read();
  }

  setup(): Promise<CertificateStatus> {
    if (this.settingUp) return this.settingUp;
    this.settingUp = this.createAndTrust().finally(() => { this.settingUp = undefined; });
    return this.settingUp;
  }

  private async createAndTrust(): Promise<CertificateStatus> {
    if (process.platform !== "darwin") throw new Error("Local certificate setup requires macOS.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const lock = join(this.directory, "setup.lock");
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Certificate setup is already running in another panel. Wait for it to finish.");
      throw error;
    }
    try {
      const status = await this.status();
      if (status.state === "ready") return status;
      if (status.state === "missing" || status.state === "expired") await this.generate();
      const home = homedir();
      const keychain = join(home, "Library", "Keychains", "login.keychain-db");
      const certificatePath = join(this.directory, "localhost.crt");
      await this.command("/usr/bin/security", [
        "add-trusted-cert", "-r", "trustRoot", "-p", "ssl", "-k", keychain, certificatePath,
      ], 120000);
      const after = await this.status();
      if (after.state !== "ready") throw new Error("macOS has not trusted the local certificate. Approve the Keychain request and try again.");
      return after;
    } finally { await rm(lock, { recursive: true, force: true }); }
  }

  private async generate() {
    const prefix = join(this.directory, "certificate-");
    const temporary = await mkdtemp(prefix);
    try {
      const config = join(temporary, "openssl.cnf");
      const key = join(temporary, "localhost.key");
      const cert = join(temporary, "localhost.crt");
      await writeFile(config, `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\nCN=${certificateName}\n[extensions]\nsubjectAltName=IP:${host}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`, { mode: 0o600 });
      await this.command("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "365", "-config", config, "-keyout", key, "-out", cert], 30000);
      await chmod(key, 0o600);
      await chmod(cert, 0o600);
      const keyTarget = join(this.directory, "localhost.key");
      const certTarget = join(this.directory, "localhost.crt");
      await rename(key, keyTarget);
      await rename(cert, certTarget);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
