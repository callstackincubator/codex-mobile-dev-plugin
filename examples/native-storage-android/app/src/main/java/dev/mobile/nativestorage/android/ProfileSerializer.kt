package dev.mobile.nativestorage.android

import androidx.datastore.core.CorruptionException
import androidx.datastore.core.Serializer
import com.google.protobuf.CodedInputStream
import com.google.protobuf.CodedOutputStream
import com.google.protobuf.InvalidProtocolBufferException
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream

data class Address(val city: String = "", val zip: String = "")

data class Profile(
    val name: String = "",
    val age: Int = 0,
    val premium: Boolean = false,
    val tags: List<String> = emptyList(),
    val address: Address = Address(),
)

/**
 * Hand-written protobuf wire format, equivalent to:
 *
 *   message Address { string city = 1; string zip = 2; }
 *   message Profile {
 *     string name = 1; int32 age = 2; bool premium = 3;
 *     repeated string tags = 4; Address address = 5;
 *   }
 */
object ProfileSerializer : Serializer<Profile> {
    private const val WIRE_TYPE_BITS = 3

    override val defaultValue: Profile = Profile()

    override suspend fun readFrom(input: InputStream): Profile {
        try {
            val stream = CodedInputStream.newInstance(input)
            var profile = Profile()
            val tags = mutableListOf<String>()
            while (true) {
                val tag = stream.readTag()
                if (tag == 0) break
                when (tag ushr WIRE_TYPE_BITS) {
                    1 -> profile = profile.copy(name = stream.readStringRequireUtf8())
                    2 -> profile = profile.copy(age = stream.readInt32())
                    3 -> profile = profile.copy(premium = stream.readBool())
                    4 -> tags += stream.readStringRequireUtf8()
                    5 -> profile = profile.copy(address = readAddress(stream.readByteArray()))
                    else -> if (!stream.skipField(tag)) break
                }
            }
            return profile.copy(tags = tags)
        } catch (e: InvalidProtocolBufferException) {
            throw CorruptionException("Cannot read profile.pb", e)
        }
    }

    override suspend fun writeTo(t: Profile, output: OutputStream) {
        val stream = CodedOutputStream.newInstance(output)
        if (t.name.isNotEmpty()) stream.writeString(1, t.name)
        if (t.age != 0) stream.writeInt32(2, t.age)
        if (t.premium) stream.writeBool(3, true)
        t.tags.forEach { stream.writeString(4, it) }
        if (t.address != Address()) stream.writeByteArray(5, writeAddress(t.address))
        stream.flush() // Do not close: DataStore owns the underlying stream.
    }

    private fun writeAddress(address: Address): ByteArray {
        val bytes = ByteArrayOutputStream()
        val stream = CodedOutputStream.newInstance(bytes)
        if (address.city.isNotEmpty()) stream.writeString(1, address.city)
        if (address.zip.isNotEmpty()) stream.writeString(2, address.zip)
        stream.flush()
        return bytes.toByteArray()
    }

    private fun readAddress(bytes: ByteArray): Address {
        val stream = CodedInputStream.newInstance(bytes)
        var address = Address()
        while (true) {
            val tag = stream.readTag()
            if (tag == 0) break
            when (tag ushr WIRE_TYPE_BITS) {
                1 -> address = address.copy(city = stream.readStringRequireUtf8())
                2 -> address = address.copy(zip = stream.readStringRequireUtf8())
                else -> if (!stream.skipField(tag)) break
            }
        }
        return address
    }
}
