import ExpoModulesCore
import MultipeerConnectivity

private let serviceType = "guideeye"
private let inviteTimeout: TimeInterval = 20

final class MultipeerLink: NSObject, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
  private let peerID: MCPeerID
  private let session: MCSession
  private let advertiser: MCNearbyServiceAdvertiser
  private let browser: MCNearbyServiceBrowser
  private let emit: (String, [String: Any]) -> Void
  private let lock = NSLock()
  private var found: [String: MCPeerID] = [:]

  init(name: String, emit: @escaping (String, [String: Any]) -> Void) {
    self.peerID = MCPeerID(displayName: name)
    self.session = MCSession(peer: peerID, securityIdentity: nil, encryptionPreference: .required)
    self.advertiser = MCNearbyServiceAdvertiser(peer: peerID, discoveryInfo: nil, serviceType: serviceType)
    self.browser = MCNearbyServiceBrowser(peer: peerID, serviceType: serviceType)
    self.emit = emit
    super.init()
    session.delegate = self
    advertiser.delegate = self
    browser.delegate = self
  }

  func start() {
    advertiser.startAdvertisingPeer()
    browser.startBrowsingForPeers()
  }

  func stop() {
    advertiser.stopAdvertisingPeer()
    browser.stopBrowsingForPeers()
    session.disconnect()
    lock.lock()
    found.removeAll()
    lock.unlock()
  }

  func invite(_ id: String) -> Bool {
    lock.lock()
    let peer = found[id]
    lock.unlock()
    guard let peer = peer, session.connectedPeers.isEmpty else { return false }
    browser.invitePeer(peer, to: session, withContext: nil, timeout: inviteTimeout)
    return true
  }

  func send(_ text: String) -> Bool {
    let peers = session.connectedPeers
    guard !peers.isEmpty, let data = text.data(using: .utf8) else { return false }
    do {
      try session.send(data, toPeers: peers, with: .reliable)
      return true
    } catch {
      emit("onError", ["message": error.localizedDescription])
      return false
    }
  }

  func disconnect() {
    session.disconnect()
  }

  func connectedPeers() -> [String] {
    return session.connectedPeers.map { $0.displayName }
  }

  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    switch state {
    case .connected:
      emit("onConnected", ["id": peerID.displayName])
    case .notConnected:
      emit("onDisconnected", ["id": peerID.displayName])
    default:
      break
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    guard let text = String(data: data, encoding: .utf8) else { return }
    emit("onMessage", ["id": peerID.displayName, "text": text])
  }

  func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}

  func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}

  func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
    if session.connectedPeers.isEmpty {
      invitationHandler(true, session)
    } else {
      invitationHandler(false, nil)
    }
  }

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
    emit("onError", ["message": error.localizedDescription])
  }

  func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
    lock.lock()
    found[peerID.displayName] = peerID
    lock.unlock()
    emit("onPeerFound", ["id": peerID.displayName])
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    lock.lock()
    found.removeValue(forKey: peerID.displayName)
    lock.unlock()
    emit("onPeerLost", ["id": peerID.displayName])
  }

  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
    emit("onError", ["message": error.localizedDescription])
  }
}

public class GuideEyeMultipeerModule: Module {
  private var link: MultipeerLink?

  public func definition() -> ModuleDefinition {
    Name("GuideEyeMultipeer")

    Events("onPeerFound", "onPeerLost", "onConnected", "onDisconnected", "onMessage", "onError")

    Function("start") { (name: String) -> Bool in
      self.link?.stop()
      let trimmed = String(name.prefix(40))
      guard !trimmed.isEmpty else { return false }
      let link = MultipeerLink(name: trimmed) { [weak self] event, body in
        self?.sendEvent(event, body)
      }
      self.link = link
      link.start()
      return true
    }

    Function("stop") {
      self.link?.stop()
      self.link = nil
    }

    Function("invite") { (id: String) -> Bool in
      return self.link?.invite(id) ?? false
    }

    Function("send") { (text: String) -> Bool in
      return self.link?.send(text) ?? false
    }

    Function("disconnect") {
      self.link?.disconnect()
    }

    Function("connectedPeers") { () -> [String] in
      return self.link?.connectedPeers() ?? []
    }

    OnDestroy {
      self.link?.stop()
      self.link = nil
    }
  }
}
