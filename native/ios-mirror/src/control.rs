use idevice::{ReadWrite, RemoteXpcClient, xpc::{Dictionary, XPCObject}};
use uuid::Uuid;
use std::time::Duration;
use std::future::Future;

async fn await_reply<T>(operation: impl Future<Output = Result<T, idevice::IdeviceError>>) -> Result<T, String> {
    let result = tokio::time::timeout(Duration::from_secs(5), operation).await;
    result.map_err(|_| "The iPhone display service did not respond.".to_string())?.map_err(|error| error.to_string())
}


pub struct Control<R: ReadWrite> {
    client: RemoteXpcClient<R>,
}

impl<R: ReadWrite> Control<R> {
    pub async fn new(stream: R) -> Result<Self, String> {
        let connect = RemoteXpcClient::new(stream);
        let mut client = await_reply(connect).await?;
        let handshake = client.do_handshake();
        await_reply(handshake).await?;
        Ok(Self { client })
    }

    pub async fn invoke(&mut self, feature: &str, input: Dictionary, action: Option<&str>) -> Result<plist::Value, String> {
        let mut version = Dictionary::new();
        version.insert("components".into(), XPCObject::Array(vec![XPCObject::UInt64(443), XPCObject::UInt64(18)]));
        version.insert("originalComponentsCount".into(), XPCObject::Int64(2));
        version.insert("stringValue".into(), XPCObject::String("443.18".into()));
        let mut request = Dictionary::new();
        request.insert("CoreDevice.CoreDeviceDDIProtocolVersion".into(), XPCObject::Int64(if action.is_some() { 2 } else { 0 }));
        request.insert("CoreDevice.coreDeviceVersion".into(), XPCObject::Dictionary(version));
        request.insert("CoreDevice.action".into(), XPCObject::Dictionary(Dictionary::new()));
        request.insert("CoreDevice.deviceIdentifier".into(), XPCObject::String(Uuid::new_v4().to_string()));
        request.insert("CoreDevice.invocationIdentifier".into(), XPCObject::String(Uuid::new_v4().to_string()));
        request.insert("CoreDevice.featureIdentifier".into(), XPCObject::String(feature.into()));
        request.insert("CoreDevice.input".into(), XPCObject::Dictionary(input));
        if let Some(action) = action {
            request.insert("CoreDevice.actionIdentifier".into(), XPCObject::String(action.into()));
        }
        let send = self.client.send_object(request, true);
        let result = tokio::time::timeout(Duration::from_secs(5), send).await;
        result.map_err(|_| "The iPhone display request timed out.")?.map_err(|error| error.to_string())?;
        let receive = self.client.recv();
        let response = await_reply(receive).await?;
        response.as_dictionary().and_then(|d| d.get("CoreDevice.output")).cloned().ok_or_else(|| "The device rejected the display request. Unlock the device and enable Developer Mode.".into())
    }

    pub async fn stop(&mut self, ids: &[u64]) -> Result<(), String> {
        if ids.is_empty() { return Ok(()); }
        let mut input = Dictionary::new();
        input.insert("stopAll".into(), XPCObject::Bool(false));
        let identifiers = ids.iter().copied().map(XPCObject::UInt64).collect();
        input.insert("identifiers".into(), XPCObject::Array(identifiers));
        self.invoke("com.apple.coredevice.feature.stopmediastream", input, Some("com.apple.coredevice.action.mediastreamstop")).await?;
        Ok(())
    }
}
