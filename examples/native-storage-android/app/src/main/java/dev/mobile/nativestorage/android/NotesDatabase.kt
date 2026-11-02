package dev.mobile.nativestorage.android

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class NotesDatabase(context: Context) : SQLiteOpenHelper(context, "notes.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY,
                title TEXT,
                body TEXT,
                pinned INTEGER,
                created_at INTEGER,
                thumbnail BLOB
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS notes")
        onCreate(db)
    }

    fun addNote(): Int {
        val number = count() + 1
        val values = ContentValues().apply {
            put("title", "Note $number")
            put("body", "Body of note $number written by the Native Storage fixture.")
            put("pinned", if (number % 2 == 0) 1 else 0)
            put("created_at", System.currentTimeMillis())
            put("thumbnail", ByteArray(32) { ((it * 7 + number) and 0xFF).toByte() })
        }
        writableDatabase.insertOrThrow("notes", null, values)
        return number
    }

    fun count(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM notes", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    fun clear() {
        writableDatabase.delete("notes", null, null)
    }
}
