use std::{env, path::PathBuf, process::Command};

fn main() {
    let configured = env::var_os("MOBILE_DEV_SENTRY_PREFIX");
    let prefix = configured.expect("Build through the plugin rebuild script to prepare Sentry Native.");
    let root = PathBuf::from(prefix);
    let include = root.join("include");
    let library = root.join("lib");
    let mut build = cc::Build::new();
    build.file("telemetry.c");
    build.include(include);
    build.define("SENTRY_BUILD_STATIC", "1");
    build.flag("-std=c11");
    build.compile("mobile_dev_telemetry");
    println!("cargo:rustc-link-search=native={}", library.display());
    println!("cargo:rustc-link-lib=static=sentry");
    println!("cargo:rustc-link-lib=curl");
    let mut command = Command::new("xcrun");
    command.args(["clang", "--print-runtime-dir"]);
    let runtime = command.output();
    let runtime = runtime.expect("Xcode's Clang runtime is required for Sentry Native.");
    assert!(runtime.status.success(), "Could not locate Clang's runtime libraries.");
    let directory = String::from_utf8(runtime.stdout);
    let directory = directory.expect("Clang runtime path must be UTF-8.");
    let directory = directory.trim();
    println!("cargo:rustc-link-search=native={}", directory);
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
    println!("cargo:rerun-if-changed=telemetry.c");
    println!("cargo:rerun-if-changed=telemetry.h");
    println!("cargo:rerun-if-env-changed=MOBILE_DEV_SENTRY_PREFIX");
}
