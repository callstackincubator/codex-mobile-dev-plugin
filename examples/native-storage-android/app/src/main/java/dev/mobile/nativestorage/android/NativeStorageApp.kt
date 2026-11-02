package dev.mobile.nativestorage.android

import android.app.Application
import com.tencent.mmkv.MMKV

class NativeStorageApp : Application() {
    override fun onCreate() {
        super.onCreate()
        MMKV.initialize(this)
    }
}
