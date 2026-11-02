package dev.mobile.nativestorage.android

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.tencent.mmkv.MMKV
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Random

// Stored at files/datastore/settings.preferences_pb
private val Context.settingsStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

// Stored at files/datastore/profile.pb. One DataStore instance per file.
private val Context.profileStore: DataStore<Profile> by lazyProfileStore()

private fun lazyProfileStore(): kotlin.properties.ReadOnlyProperty<Context, DataStore<Profile>> {
    var instance: DataStore<Profile>? = null
    return kotlin.properties.ReadOnlyProperty { context, _ ->
        synchronized(ProfileSerializer) {
            instance ?: DataStoreFactory.create(
                serializer = ProfileSerializer,
                produceFile = { File(context.applicationContext.filesDir, "datastore/profile.pb") },
            ).also { instance = it }
        }
    }
}

class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var summary: TextView

    private val themeKey = stringPreferencesKey("theme")
    private val notificationsKey = booleanPreferencesKey("notifications")
    private val launchCountKey = intPreferencesKey("launchCount")

    private val userKeys = listOf(
        "user.name", "user.id", "isLoggedIn", "lastLogin", "fontScale", "interests", "session",
    )

    private val defaultPrefs: SharedPreferences
        get() = getSharedPreferences("${packageName}_preferences", MODE_PRIVATE)

    private val notes by lazy { NotesDatabase(applicationContext) }

    private val securePrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            applicationContext,
            "secret_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        summary = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(16), 0, 0)
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        column.addView(
            TextView(this).apply {
                text = "Native Storage"
                textSize = 22f
                setPadding(0, 0, 0, dp(8))
            },
        )
        action(column, "Sign in") { signIn() }
        action(column, "Sign out") { signOut() }
        action(column, "Save secret") { saveSecret() }
        action(column, "Add note") { notes.addNote() }
        action(column, "Toggle theme") { toggleTheme() }
        action(column, "Save profile") { saveProfile() }
        action(column, "Write MMKV") { writeMmkv() }
        action(column, "Write files") { writeFiles() }
        action(column, "Clear everything") { clearEverything() }
        column.addView(summary)
        setContentView(
            ScrollView(this).apply {
                // Target SDK 35+ draws edge-to-edge; keep buttons out of the system bars.
                fitsSystemWindows = true
                addView(
                    column,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                    ),
                )
            },
        )
        refreshSummary()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun action(parent: LinearLayout, label: String, block: suspend () -> Unit) {
        parent.addView(
            Button(this).apply {
                text = label
                isAllCaps = false
                setOnClickListener {
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { block() }
                        } catch (e: Exception) {
                            summary.text = "$label failed: ${e::class.java.simpleName}: ${e.message}"
                            return@launch
                        }
                        refreshSummary()
                    }
                }
            },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
    }

    private fun signIn() {
        defaultPrefs.edit()
            .putString("user.name", "Ada Lovelace")
            .putInt("user.id", 4211)
            .putBoolean("isLoggedIn", true)
            .putLong("lastLogin", System.currentTimeMillis())
            .putFloat("fontScale", 1.1f)
            .putStringSet("interests", setOf("kotlin", "android"))
            .putString("session", JSONObject().put("token", "tok_live_1234").put("plan", "pro").toString())
            .apply()
    }

    private fun signOut() {
        defaultPrefs.edit().apply { userKeys.forEach { remove(it) } }.apply()
    }

    private fun saveSecret() {
        securePrefs.edit()
            .putString("api_token", "sk_test_4242")
            .putString("pin", "1234")
            .apply()
    }

    private suspend fun toggleTheme() {
        settingsStore.edit { prefs ->
            prefs[themeKey] = if (prefs[themeKey] == "dark") "light" else "dark"
            prefs[notificationsKey] = true
            prefs[launchCountKey] = (prefs[launchCountKey] ?: 0) + 1
        }
    }

    private suspend fun saveProfile() {
        profileStore.updateData {
            Profile(
                name = "Ada Lovelace",
                age = 36,
                premium = true,
                tags = listOf("beta", "admin"),
                address = Address(city = "Berlin", zip = "10115"),
            )
        }
    }

    private fun writeMmkv() {
        val defaults = MMKV.defaultMMKV()
        defaults.encode("user.name", "Ada Lovelace")
        defaults.encode("launchCount", defaults.decodeInt("launchCount", 0) + 1)
        defaults.encode("onboarded", true)
        val cache = MMKV.mmkvWithID("cache")
        cache.encode("last_sync", System.currentTimeMillis())
        cache.encode("feed_etag", "W/\"a1b2c3\"")
        cache.encode("hit_ratio", 0.82)
    }

    private fun writeFiles() {
        File(filesDir, "notes.txt").writeText("Remember to review the storage fixture.\nSecond line of notes.\n")
        val profile = JSONObject()
            .put("name", "Ada Lovelace")
            .put("age", 36)
            .put("premium", true)
            .put("tags", JSONArray(listOf("beta", "admin")))
            .put("address", JSONObject().put("city", "Berlin").put("zip", "10115"))
        File(filesDir, "profile.json").writeText(profile.toString(2) + "\n")
        File(cacheDir, "image-cache.bin").writeBytes(ByteArray(256 * 1024).also { Random(42).nextBytes(it) })
    }

    private suspend fun clearEverything() {
        defaultPrefs.edit().clear().apply()
        securePrefs.edit().clear().apply()
        notes.clear()
        settingsStore.edit { it.clear() }
        profileStore.updateData { ProfileSerializer.defaultValue }
        MMKV.defaultMMKV().clearAll()
        MMKV.mmkvWithID("cache").clearAll()
        File(filesDir, "notes.txt").delete()
        File(filesDir, "profile.json").delete()
        File(cacheDir, "image-cache.bin").delete()
    }

    private fun refreshSummary() {
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                val prefs = defaultPrefs
                val settings = settingsStore.data.first()
                val profile = profileStore.data.first()
                buildString {
                    appendLine("prefs user.name: ${prefs.getString("user.name", null) ?: "-"}")
                    appendLine("secret api_token set: ${securePrefs.contains("api_token")}")
                    appendLine("notes: ${notes.count()}")
                    appendLine("theme: ${settings[themeKey] ?: "-"}, launchCount: ${settings[launchCountKey] ?: 0}")
                    appendLine("profile: ${profile.name.ifEmpty { "-" }} (${profile.address.city.ifEmpty { "-" }})")
                    appendLine("mmkv user.name: ${MMKV.defaultMMKV().decodeString("user.name") ?: "-"}")
                    append("files: ${File(filesDir, "notes.txt").exists()}, cache: ${File(cacheDir, "image-cache.bin").exists()}")
                }
            }
            summary.text = text
        }
    }
}
