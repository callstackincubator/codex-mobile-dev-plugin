use std::{env, fs, path::PathBuf, process::Command};

fn names_between<'a>(source: &'a str, start: &str) -> Vec<&'a str> {
    let body = source.split_once(start).map(|(_, rest)| rest);
    let body = body.and_then(|rest| rest.split_once('}')).map(|(body, _)| body);
    let body = body.unwrap_or_else(|| panic!("Could not find `{start}`."));
    body.split(',').map(str::trim).filter(|name| !name.is_empty()).collect()
}

fn c_name(variant: &str) -> String {
    let mut name = String::from("MOBILE_DEV");
    for character in variant.chars() {
        if character.is_uppercase() { name.push('_'); }
        name.push(character.to_ascii_uppercase());
    }
    name
}

// `Timing` is passed to C by discriminant, so it must list telemetry.h's
// timings in the same order. Fail the build instead of misattributing metrics.
fn check_timings() {
    let header = fs::read_to_string("telemetry.h").expect("telemetry.h is readable");
    let wrapper = fs::read_to_string("src/lib.rs").expect("src/lib.rs is readable");
    let mut c_timings = names_between(&header, "enum mobile_dev_timing {");
    assert_eq!(c_timings.pop(), Some("MOBILE_DEV_TIMING_COUNT"), "telemetry.h must end its timings with MOBILE_DEV_TIMING_COUNT.");
    let rust_timings: Vec<String> = names_between(&wrapper, "pub enum Timing {").into_iter().map(c_name).collect();
    assert_eq!(rust_timings, c_timings, "The Rust Timing enum must match telemetry.h's mobile_dev_timing in order.");
}

fn main() {
    check_timings();
    println!("cargo:rerun-if-changed=src/lib.rs");
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
