package ai.guideband.app

import android.Manifest
import android.app.role.RoleManager
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ai.guideband.app.databinding.ActivityMainBinding
import ai.guideband.app.voice.ListeningService

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var startAfterPermission = false
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (startAfterPermission && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
        else updateStatus()
        startAfterPermission = false
    }
    private val assistantRole = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { updateStatus() }
    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            binding.statusText.text = intent?.getStringExtra(ListeningService.EXTRA_MESSAGE) ?: return
        }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state); binding = ActivityMainBinding.inflate(layoutInflater); setContentView(binding.root)
        binding.startAssistant.setOnClickListener { requestAudioAndStart() }
        binding.stopAssistant.setOnClickListener { stopService(Intent(this, ListeningService::class.java)); updateStatus() }
        binding.chooseAssistant.setOnClickListener { chooseAssistant() }
        binding.enableAccessibility.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        binding.grantNotifications.setOnClickListener { requestPermissions() }
        binding.bridgeButton.setOnClickListener { startActivity(Intent(this, BridgeActivity::class.java)) }
        updateStatus()
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(this, statusReceiver, IntentFilter(ListeningService.ACTION_STATUS), ContextCompat.RECEIVER_NOT_EXPORTED)
        updateStatus()
    }

    override fun onStop() { unregisterReceiver(statusReceiver); super.onStop() }

    private fun requestPermissions() {
        val list = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) list += Manifest.permission.POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT >= 31) list += Manifest.permission.BLUETOOTH_CONNECT
        permissions.launch(list.toTypedArray())
    }

    private fun requestAudioAndStart() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            startAfterPermission = true
            requestPermissions()
            return
        }
        startListening()
    }

    private fun startListening() {
        ContextCompat.startForegroundService(this, Intent(this, ListeningService::class.java))
        binding.statusText.text = "Starting microphone…"
    }

    private fun chooseAssistant() {
        if (Build.VERSION.SDK_INT >= 29) {
            val manager = getSystemService(RoleManager::class.java)
            if (manager.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) { assistantRole.launch(manager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT)); return }
        }
        startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS))
    }

    private fun updateStatus() {
        if (ListeningService.running) return
        val audio = getSystemService(AudioManager::class.java)
        val inputs = audio.getDevices(AudioManager.GET_DEVICES_INPUTS)
        val source = if (inputs.isEmpty()) "No audio input detected" else "${inputs.size} audio input${if (inputs.size == 1) "" else "s"} available"
        binding.statusText.text = "Ready · $source · tap Start"
    }
}
