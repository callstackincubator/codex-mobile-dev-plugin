#include <assert.h>
#include <bare.h>
#include <js.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <url.h>
#include <utf.h>
#include <utf/string.h>
#include <uv.h>

// Maximum length, in bytes, of a UTF-8 string that is read into a stack buffer.
// Longer strings fall back to a heap allocation. This covers the vast majority
// of URLs without touching the heap.
#define BARE_URL_STACK_STRING_MAX 1024

// The number of component offsets the parser writes out.
#define BARE_URL_COMPONENTS_LEN (sizeof(((url_t *) 0)->components) / sizeof(url_component_t))

static bool
bare_url__check_argc(js_env_t *env, size_t argc, size_t expected) {
  int err;

  if (argc < expected) {
    err = js_throw_type_errorf(env, NULL, "Expected %zu arguments, got %zu", expected, argc);
    assert(err == 0);

    return false;
  }

  return true;
}

static bool
bare_url__check_string(js_env_t *env, js_value_t *value, const char *message) {
  int err;

  bool is_string;
  err = js_is_string(env, value, &is_string);
  assert(err == 0);

  if (!is_string) {
    err = js_throw_type_error(env, NULL, message);
    assert(err == 0);
  }

  return is_string;
}

static bool
bare_url__check_base(js_env_t *env, js_value_t *value, bool *has_base) {
  int err;

  js_value_type_t type;
  err = js_typeof(env, value, &type);
  assert(err == 0);

  *has_base = type == js_string;

  if (type == js_string || type == js_null || type == js_undefined) return true;

  err = js_throw_type_error(env, NULL, "Base must be a string, null, or undefined");
  assert(err == 0);

  return false;
}

static bool
bare_url__check_boolean(js_env_t *env, js_value_t *value, const char *message) {
  int err;

  bool is_boolean;
  err = js_is_boolean(env, value, &is_boolean);
  assert(err == 0);

  if (!is_boolean) {
    err = js_throw_type_error(env, NULL, message);
    assert(err == 0);
  }

  return is_boolean;
}

static bool
bare_url__check_components(js_env_t *env, js_value_t *value, uint32_t **result) {
  int err;

  bool is_typedarray;
  err = js_is_typedarray(env, value, &is_typedarray);
  assert(err == 0);

  js_typedarray_type_t type;
  size_t len;
  js_value_t *arraybuffer;

  if (is_typedarray) {
    err = js_get_typedarray_info(env, value, &type, (void **) result, &len, &arraybuffer, NULL);
    if (err < 0) return false;
  }

  if (!is_typedarray || type != js_uint32array) {
    err = js_throw_type_error(env, NULL, "Components must be a Uint32Array");
    assert(err == 0);

    return false;
  }

  // A detached typed array reports no length of its own, but its data pointer
  // is stale rather than null and so must not be written to.
  bool is_detached;
  err = js_is_detached_arraybuffer(env, arraybuffer, &is_detached);
  assert(err == 0);

  if (is_detached) {
    err = js_throw_type_error(env, NULL, "Components must not be detached");
    assert(err == 0);

    return false;
  }

  if (len < BARE_URL_COMPONENTS_LEN) {
    err = js_throw_range_errorf(env, NULL, "Components must have at least %zu elements, got %zu", (size_t) BARE_URL_COMPONENTS_LEN, len);
    assert(err == 0);

    return false;
  }

  return true;
}

// The UTF-8 encoding of a JavaScript string, together with whatever backs it.
typedef struct {
  const utf8_t *data;
  size_t len;

  js_string_view_t *view;
  utf8_t *heap;
} bare_url_string_t;

// Exposes `value` as UTF-8. Strings that are stored as ASCII, which is nearly
// all of them, are borrowed directly from the engine without being copied.
// Anything else is transcoded into `stack`, or into a freshly allocated heap
// buffer when it does not fit. A non-zero return leaves an exception pending.
// The result must be released with bare_url__free_string() either way.
static inline int
bare_url__read_string(js_env_t *env, js_value_t *value, utf8_t *stack, size_t stack_len, bare_url_string_t *result) {
  int err;

  result->data = NULL;
  result->len = 0;
  result->view = NULL;
  result->heap = NULL;

  js_string_encoding_t encoding;
  const void *data;
  size_t len;

  err = js_get_string_view(env, value, &encoding, &data, &len, &result->view);
  if (err < 0) return err;

  size_t utf8_len;

  if (encoding == js_utf8) {
    result->data = (const utf8_t *) data;
    result->len = len;

    return 0;
  }

  if (encoding == js_latin1) {
    utf8_len = utf8_length_from_latin1((const latin1_t *) data, len);

    // A Latin-1 string that is no longer as UTF-8 contains only ASCII, whose
    // Latin-1 and UTF-8 encodings are identical.
    if (utf8_len == len) {
      result->data = (const utf8_t *) data;
      result->len = len;

      return 0;
    }
  } else {
    assert(encoding == js_utf16le);

    utf8_len = utf8_length_from_utf16le((const utf16_t *) data, len);
  }

  utf8_t *buffer;

  if (utf8_len <= stack_len) {
    buffer = stack;
  } else {
    buffer = result->heap = malloc(utf8_len);

    if (buffer == NULL) {
      err = js_release_string_view(env, result->view);
      assert(err == 0);

      result->view = NULL;

      err = js_throw_error(env, uv_err_name(UV_ENOMEM), uv_strerror(UV_ENOMEM));
      assert(err == 0);

      return -1;
    }
  }

  if (encoding == js_latin1) {
    latin1_convert_to_utf8((const latin1_t *) data, len, buffer);
  } else {
    utf16le_convert_to_utf8((const utf16_t *) data, len, buffer);
  }

  result->data = buffer;
  result->len = utf8_len;

  return 0;
}

// Releases a string read with bare_url__read_string(), freeing its buffer only
// when it was heap allocated rather than borrowed or written to the caller's
// stack buffer.
static inline void
bare_url__free_string(js_env_t *env, bare_url_string_t *string) {
  int err;

  free(string->heap);

  if (string->view == NULL) return;

  err = js_release_string_view(env, string->view);
  assert(err == 0);
}

static js_value_t *
bare_url_parse(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 4;
  js_value_t *argv[4];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  if (!bare_url__check_argc(env, argc, 4)) return NULL;

  if (!bare_url__check_string(env, argv[0], "Input must be a string")) return NULL;

  bool has_base;
  if (!bare_url__check_base(env, argv[1], &has_base)) return NULL;

  uint32_t *components;
  if (!bare_url__check_components(env, argv[2], &components)) return NULL;

  if (!bare_url__check_boolean(env, argv[3], "Throw must be a boolean")) return NULL;

  bool should_throw;
  err = js_get_value_bool(env, argv[3], &should_throw);
  assert(err == 0);

  // Set when the input could not be read, which leaves an exception of its own
  // pending and so must not be reported as a parse failure on top.
  bool threw = false;

  url_t base;
  url_init(&base);

  if (has_base) {
    utf8_t stack[BARE_URL_STACK_STRING_MAX];

    bare_url_string_t input;
    err = bare_url__read_string(env, argv[1], stack, sizeof(stack), &input);

    if (err == 0) err = url_parse(&base, input.data, input.len, NULL);
    else threw = true;

    bare_url__free_string(env, &input);

    if (err < 0) {
      url_destroy(&base);

      if (should_throw && !threw) {
        err = js_throw_error(env, NULL, "Invalid base URL");
        assert(err == 0);
      }

      return NULL;
    }
  }

  utf8_t stack[BARE_URL_STACK_STRING_MAX];

  bare_url_string_t input;
  err = bare_url__read_string(env, argv[0], stack, sizeof(stack), &input);

  url_t url;
  url_init(&url);

  if (err == 0) err = url_parse(&url, input.data, input.len, has_base ? &base : NULL);
  else threw = true;

  bare_url__free_string(env, &input);

  if (err < 0) {
    url_destroy(&base);
    url_destroy(&url);

    if (should_throw && !threw) {
      err = js_throw_error(env, NULL, "Invalid URL");
      assert(err == 0);
    }

    return NULL;
  }

  js_value_t *href;
  err = js_create_string_latin1(env, (const latin1_t *) url.href.data, url.href.len, &href);

  // The offsets are only handed over once the href they refer to is, so a
  // failure here leaves the caller's buffer as it was.
  if (err == 0) memcpy(components, &url.components, sizeof(url.components));

  url_destroy(&base);
  url_destroy(&url);

  if (err < 0) return NULL;

  return href;
}

static js_value_t *
bare_url_can_parse(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  if (!bare_url__check_argc(env, argc, 2)) return NULL;

  if (!bare_url__check_string(env, argv[0], "Input must be a string")) return NULL;

  bool has_base;
  if (!bare_url__check_base(env, argv[1], &has_base)) return NULL;

  bool threw = false;

  url_t base;
  url_init(&base);

  if (has_base) {
    utf8_t stack[BARE_URL_STACK_STRING_MAX];

    bare_url_string_t input;
    err = bare_url__read_string(env, argv[1], stack, sizeof(stack), &input);

    if (err == 0) err = url_parse(&base, input.data, input.len, NULL);
    else threw = true;

    bare_url__free_string(env, &input);

    if (err < 0) {
      url_destroy(&base);

      if (threw) return NULL;

      js_value_t *result;
      err = js_get_boolean(env, false, &result);
      assert(err == 0);

      return result;
    }
  }

  utf8_t stack[BARE_URL_STACK_STRING_MAX];

  bare_url_string_t input;
  err = bare_url__read_string(env, argv[0], stack, sizeof(stack), &input);

  url_t url;
  url_init(&url);

  if (err == 0) err = url_parse(&url, input.data, input.len, has_base ? &base : NULL);
  else threw = true;

  bare_url__free_string(env, &input);

  url_destroy(&base);
  url_destroy(&url);

  if (threw) return NULL;

  js_value_t *result;
  err = js_get_boolean(env, err == 0, &result);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_url_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("parse", bare_url_parse)
  V("canParse", bare_url_can_parse)
#undef V

  return exports;
}

BARE_MODULE(bare_url, bare_url_exports)
