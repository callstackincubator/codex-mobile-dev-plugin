package dev.mobile.nativestorage.android

import android.app.Application
import com.tencent.mmkv.MMKV

class NativeStorageApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Stores MMKV files under filesDir/mmkv.
        MMKV.initialize(this)
    }
}
