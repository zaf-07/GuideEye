import AVFoundation
import ExpoModulesCore
import Vision

public final class GuideEyeHandsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GuideEyeHands")
    Function("isSupported") { AVCaptureDevice.default(for: .video) != nil }
    View(GuideEyeHandsView.self) {
      Events("onHands", "onStatus")
      Prop("active") { (view: GuideEyeHandsView, active: Bool) in view.active = active }
      Prop("facing") { (view: GuideEyeHandsView, facing: String) in view.facing = facing }
    }
  }
}

final class GuideEyeHandsView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onHands = EventDispatcher()
  let onStatus = EventDispatcher()
  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let queue = DispatchQueue(label: "GuideEye.hands.capture", qos: .userInitiated)
  private let request = VNDetectHumanHandPoseRequest()
  private var input: AVCaptureDeviceInput?
  private var lastFrame = CMTime.invalid
  private lazy var preview = AVCaptureVideoPreviewLayer(session: session)
  var active = false { didSet { if oldValue != active { updateCamera() } } }
  var facing = "back" { didSet { if oldValue != facing { updateCamera() } } }

  private static let joints: [VNHumanHandPoseObservation.JointName] = [
    .wrist, .thumbCMC, .thumbMP, .thumbIP, .thumbTip,
    .indexMCP, .indexPIP, .indexDIP, .indexTip,
    .middleMCP, .middlePIP, .middleDIP, .middleTip,
    .ringMCP, .ringPIP, .ringDIP, .ringTip,
    .littleMCP, .littlePIP, .littleDIP, .littleTip,
  ]

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    preview.videoGravity = .resizeAspectFill
    layer.addSublayer(preview)
    request.maximumHandCount = 2
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    preview.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateCamera()
  }

  private func updateCamera() {
    let shouldRun = window != nil && active
    let position: AVCaptureDevice.Position = facing == "front" ? .front : .back
    queue.async { [weak self] in
      guard let self else { return }
      if !shouldRun {
        if self.session.isRunning { self.session.stopRunning() }
        return
      }
      guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
        self.status("denied", "Camera permission is required.")
        return
      }
      if self.input?.device.position != position {
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let next = try? AVCaptureDeviceInput(device: camera) else {
          self.status("error", "Camera unavailable.")
          return
        }
        self.session.beginConfiguration()
        self.session.sessionPreset = .vga640x480
        if let previous = self.input { self.session.removeInput(previous) }
        self.input = nil
        if self.session.canAddInput(next) {
          self.session.addInput(next)
          self.input = next
        }
        if self.session.canAddOutput(self.output) { self.session.addOutput(self.output) }
        if let connection = self.output.connection(with: .video) {
          connection.videoOrientation = .portrait
          if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = false
          }
        }
        self.session.commitConfiguration()
      }
      guard self.input != nil, self.output.connection(with: .video) != nil else {
        self.status("error", "Could not start hand tracking.")
        return
      }
      if !self.session.isRunning { self.session.startRunning() }
      DispatchQueue.main.async { [weak self] in self?.preview.connection?.videoOrientation = .portrait }
      self.status("running", "")
    }
  }

  private func status(_ state: String, _ detail: String) {
    DispatchQueue.main.async { [weak self] in self?.onStatus(["state": state, "detail": detail]) }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    if lastFrame.isValid && CMTimeGetSeconds(time - lastFrame) < 0.05 { return }
    lastFrame = time
    guard let image = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    do {
      try VNImageRequestHandler(cvPixelBuffer: image, orientation: .up).perform([request])
    } catch {
      return
    }
    let hands: [[String: Any]] = (request.results ?? []).compactMap { observation in
      guard let points = try? observation.recognizedPoints(.all) else { return nil }
      let landmarks: [[String: Double]] = Self.joints.compactMap { joint in
        guard let point = points[joint] else { return nil }
        return ["x": point.location.x, "y": 1 - point.location.y, "z": 0, "confidence": Double(point.confidence)]
      }
      let confidence = landmarks.reduce(0.0) { $0 + ($1["confidence"] ?? 0) } / Double(Self.joints.count)
      guard landmarks.count == Self.joints.count, confidence >= 0.45 else { return nil }
      let hand = observation.chirality == .left ? "left" : observation.chirality == .right ? "right" : "unknown"
      return ["chirality": hand, "confidence": confidence, "landmarks": landmarks]
    }
    DispatchQueue.main.async { [weak self] in
      guard let self, self.window != nil, self.active else { return }
      self.onHands(["hands": hands, "count": hands.count, "timestamp": Date().timeIntervalSince1970 * 1000])
    }
  }
}
