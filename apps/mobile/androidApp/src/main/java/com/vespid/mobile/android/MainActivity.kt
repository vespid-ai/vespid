package com.vespid.mobile.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vespid.mobile.shared.api.VespidApiClient
import com.vespid.mobile.shared.model.AgentSession
import com.vespid.mobile.shared.model.MeOrg
import com.vespid.mobile.shared.realtime.SessionRealtimeClient
import com.vespid.mobile.shared.realtime.SessionRealtimeMessage
import com.vespid.mobile.shared.repo.AuthRepository
import com.vespid.mobile.shared.repo.InMemoryTokenStore
import com.vespid.mobile.shared.repo.OrgRepository
import com.vespid.mobile.shared.repo.SessionRepository
import com.vespid.mobile.shared.state.StreamReducer
import com.vespid.mobile.shared.state.TerminalLine
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.serialization.kotlinx.json.json
import java.time.Instant
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    val json = Json {
      ignoreUnknownKeys = true
      explicitNulls = false
      encodeDefaults = true
    }
    val httpClient = HttpClient(OkHttp) {
      install(ContentNegotiation) { json(json) }
      install(HttpTimeout) {
        connectTimeoutMillis = 4_000
        requestTimeoutMillis = 12_000
        socketTimeoutMillis = 12_000
      }
      install(WebSockets)
    }
    val apiClient = VespidApiClient(httpClient, BuildConfig.API_BASE_URL)
    val realtimeClient = SessionRealtimeClient(httpClient, BuildConfig.GATEWAY_WS_BASE_URL, json)

    val viewModelFactory = MobileViewModelFactory(
      authRepository = AuthRepository(apiClient, InMemoryTokenStore()),
      orgRepository = OrgRepository(apiClient),
      sessionRepository = SessionRepository(apiClient, realtimeClient),
    )

    setContent {
      val viewModel: MobileViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = viewModelFactory)
      MobileApp(viewModel)
    }
  }
}

private class MobileViewModelFactory(
  private val authRepository: AuthRepository,
  private val orgRepository: OrgRepository,
  private val sessionRepository: SessionRepository,
) : ViewModelProvider.Factory {
  @Suppress("UNCHECKED_CAST")
  override fun <T : ViewModel> create(modelClass: Class<T>): T {
    return MobileViewModel(
      authRepository = authRepository,
      orgRepository = orgRepository,
      sessionRepository = sessionRepository,
    ) as T
  }
}

data class MobileUiState(
  val loading: Boolean = false,
  val authenticated: Boolean = false,
  val email: String = "",
  val password: String = "",
  val authError: String? = null,
  val token: String? = null,
  val orgs: List<MeOrg> = emptyList(),
  val selectedOrgId: String? = null,
  val sessions: List<AgentSession> = emptyList(),
  val selectedSession: AgentSession? = null,
  val terminalLines: List<TerminalLine> = emptyList(),
  val input: String = "",
  val wsStatus: String = "DISCONNECTED",
  val createModel: String = "gpt-5-codex",
  val createInstructions: String = "Help me execute commands safely and efficiently.",
  val createSystem: String = "",
)

class MobileViewModel(
  private val authRepository: AuthRepository,
  private val orgRepository: OrgRepository,
  private val sessionRepository: SessionRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(MobileUiState())
  val state: StateFlow<MobileUiState> = _state.asStateFlow()

  private var wsJob: Job? = null

  fun setEmail(value: String) = _state.update { it.copy(email = value) }
  fun setPassword(value: String) = _state.update { it.copy(password = value) }
  fun setInput(value: String) = _state.update { it.copy(input = value) }
  fun setCreateModel(value: String) = _state.update { it.copy(createModel = value) }
  fun setCreateInstructions(value: String) = _state.update { it.copy(createInstructions = value) }
  fun setCreateSystem(value: String) = _state.update { it.copy(createSystem = value) }

  fun login() {
    viewModelScope.launch {
      val email = state.value.email.trim()
      val password = state.value.password
      if (email.isEmpty() || password.isEmpty()) return@launch
      _state.update { it.copy(loading = true, authError = null) }

      runCatching { authRepository.login(email = email, password = password) }
        .onSuccess { response ->
          _state.update { it.copy(authenticated = true, token = response.session.token, loading = false) }
          refreshOrgs()
        }
        .onFailure { error ->
          _state.update { it.copy(loading = false, authError = error.message ?: "Login failed") }
        }
    }
  }

  fun refreshOrgs() {
    viewModelScope.launch {
      val token = state.value.token ?: return@launch
      runCatching { orgRepository.loadMe(token) }
        .onSuccess { me ->
          val preferredOrgId = me.orgs.firstOrNull { !it.name.equals("Personal workspace", ignoreCase = true) }?.id
          val selectedOrgId = state.value.selectedOrgId ?: preferredOrgId ?: me.defaultOrgId ?: me.orgs.firstOrNull()?.id
          _state.update { it.copy(orgs = me.orgs, selectedOrgId = selectedOrgId) }
          if (selectedOrgId != null) {
            refreshSessions(selectedOrgId)
          }
        }
        .onFailure { error ->
          _state.update { it.copy(authError = error.message ?: "Failed to load organizations") }
        }
    }
  }

  fun selectOrg(orgId: String) {
    _state.update { it.copy(selectedOrgId = orgId, selectedSession = null, terminalLines = emptyList()) }
    refreshSessions(orgId)
  }

  fun refreshSessions(orgId: String? = state.value.selectedOrgId) {
    val resolvedOrgId = orgId ?: return
    viewModelScope.launch {
      val token = state.value.token ?: return@launch
      runCatching { sessionRepository.listSessions(token = token, orgId = resolvedOrgId) }
        .onSuccess { sessions ->
          _state.update { it.copy(sessions = sessions) }
        }
        .onFailure { error ->
          _state.update { it.copy(authError = error.message ?: "Failed to load sessions") }
        }
    }
  }

  fun createSession(engineId: String) {
    viewModelScope.launch {
      val snapshot = state.value
      val token = snapshot.token ?: return@launch
      val orgId = snapshot.selectedOrgId ?: return@launch

      runCatching {
        sessionRepository.createSession(
          token = token,
          orgId = orgId,
          engineId = engineId,
          model = snapshot.createModel,
          instructions = snapshot.createInstructions,
          system = snapshot.createSystem.takeIf { it.isNotBlank() },
          allowTools = listOf("connector.action", "agent.execute"),
        )
      }.onSuccess { session ->
        refreshSessions(orgId)
        openSession(session)
      }.onFailure { error ->
        _state.update { it.copy(authError = error.message ?: "Failed to create session") }
      }
    }
  }

  fun openSession(session: AgentSession) {
    viewModelScope.launch {
      val snapshot = state.value
      val token = snapshot.token ?: return@launch
      val orgId = snapshot.selectedOrgId ?: return@launch

      wsJob?.cancel()
      sessionRepository.disconnect()
      _state.update { it.copy(selectedSession = session, terminalLines = emptyList(), wsStatus = "CONNECTING") }

      val historical = runCatching {
        sessionRepository.listEvents(token = token, orgId = orgId, sessionId = session.id)
      }.getOrDefault(emptyList())

      _state.update { it.copy(terminalLines = StreamReducer.merge(it.terminalLines, historical)) }

      runCatching {
        sessionRepository.connect(token = token, orgId = orgId, sessionId = session.id)
      }.onFailure { error ->
        _state.update { it.copy(wsStatus = "ERROR", authError = error.message ?: "WebSocket connect failed") }
        return@launch
      }

      _state.update { it.copy(wsStatus = "CONNECTED") }
      wsJob = launch {
        sessionRepository.events().collect { event ->
          _state.update { current ->
            val nextLines = when (event) {
              is SessionRealtimeMessage.EventV2 -> StreamReducer.mergeEvent(current.terminalLines, event.value)
              is SessionRealtimeMessage.StreamV1 -> StreamReducer.mergeStream(current.terminalLines, event.value)
              is SessionRealtimeMessage.Delta -> StreamReducer.mergeDelta(current.terminalLines, event.value)
              is SessionRealtimeMessage.Final -> StreamReducer.mergeFinal(current.terminalLines, event.value)
              is SessionRealtimeMessage.Error -> current.terminalLines + TerminalLine.StreamEventLine(
                requestId = "session_error",
                streamSeq = Int.MAX_VALUE,
                kind = "session_error",
                level = "error",
                text = "${event.value.code}: ${event.value.message}",
                createdAt = Instant.now().toString(),
              )
              else -> current.terminalLines
            }
            current.copy(terminalLines = nextLines)
          }
        }
      }
    }
  }

  fun send() {
    viewModelScope.launch {
      val snapshot = state.value
      val input = snapshot.input.trim()
      if (input.isEmpty()) return@launch
      val token = snapshot.token ?: return@launch
      val orgId = snapshot.selectedOrgId ?: return@launch
      val sessionId = snapshot.selectedSession?.id ?: return@launch

      val connected = runCatching {
        sessionRepository.connect(token = token, orgId = orgId, sessionId = sessionId)
      }.onFailure { error ->
        _state.update {
          it.copy(
            wsStatus = "ERROR",
            authError = error.message ?: "WebSocket reconnect failed"
          )
        }
      }.isSuccess
      if (!connected) return@launch
      _state.update { it.copy(wsStatus = "CONNECTED") }

      when {
        input == "/stop" -> sessionRepository.stop(sessionId)
        input == "/reset" -> sessionRepository.reset(sessionId, clearHistory = false)
        input == "/reset --clear" -> sessionRepository.reset(sessionId, clearHistory = true)
        input == "/new" -> createSession(engineId = "gateway.codex.v2")
        else -> sessionRepository.send(sessionId, input)
      }
      _state.update { it.copy(input = "") }
    }
  }
}

@Composable
private fun MobileApp(viewModel: MobileViewModel) {
  val state by viewModel.state.collectAsState()

  MaterialTheme {
    Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
      if (!state.authenticated) {
        LoginView(
          modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .padding(16.dp),
          state = state,
          onEmail = viewModel::setEmail,
          onPassword = viewModel::setPassword,
          onLogin = viewModel::login,
        )
      } else {
        TerminalWorkspace(
          modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .padding(12.dp),
          state = state,
          onSelectOrg = viewModel::selectOrg,
          onOpenSession = viewModel::openSession,
          onSend = viewModel::send,
          onInput = viewModel::setInput,
          onRefreshSessions = { viewModel.refreshSessions() },
          onCreateSession = viewModel::createSession,
          onCreateModel = viewModel::setCreateModel,
          onCreateInstructions = viewModel::setCreateInstructions,
          onCreateSystem = viewModel::setCreateSystem,
        )
      }
    }
  }
}

@Composable
private fun LoginView(
  modifier: Modifier,
  state: MobileUiState,
  onEmail: (String) -> Unit,
  onPassword: (String) -> Unit,
  onLogin: () -> Unit,
) {
  Column(modifier = modifier, verticalArrangement = Arrangement.Center) {
    Text(text = stringResource(R.string.login_title), style = MaterialTheme.typography.headlineMedium)
    Spacer(modifier = Modifier.height(16.dp))
    OutlinedTextField(value = state.email, onValueChange = onEmail, label = { Text(stringResource(R.string.email)) }, modifier = Modifier.fillMaxWidth())
    Spacer(modifier = Modifier.height(8.dp))
    OutlinedTextField(value = state.password, onValueChange = onPassword, label = { Text(stringResource(R.string.password)) }, modifier = Modifier.fillMaxWidth())
    Spacer(modifier = Modifier.height(12.dp))
    Button(onClick = onLogin, modifier = Modifier.fillMaxWidth(), enabled = !state.loading) {
      Text(if (state.loading) stringResource(R.string.loading) else stringResource(R.string.login_action))
    }
    if (state.authError != null) {
      Spacer(modifier = Modifier.height(8.dp))
      Text(text = state.authError, color = MaterialTheme.colorScheme.error)
    }
  }
}

@Composable
private fun TerminalWorkspace(
  modifier: Modifier,
  state: MobileUiState,
  onSelectOrg: (String) -> Unit,
  onOpenSession: (AgentSession) -> Unit,
  onSend: () -> Unit,
  onInput: (String) -> Unit,
  onRefreshSessions: () -> Unit,
  onCreateSession: (String) -> Unit,
  onCreateModel: (String) -> Unit,
  onCreateInstructions: (String) -> Unit,
  onCreateSystem: (String) -> Unit,
) {
  val canSend = state.selectedSession != null && state.wsStatus == "CONNECTED"
  Column(modifier = modifier.fillMaxSize()) {
    Column(
      modifier = Modifier
        .weight(1f)
        .verticalScroll(rememberScrollState())
    ) {
      Text(text = stringResource(R.string.workspace_title), style = MaterialTheme.typography.titleLarge)
      Spacer(modifier = Modifier.height(8.dp))

      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(text = stringResource(R.string.org_label))
        Spacer(modifier = Modifier.width(8.dp))
        var expanded by remember { mutableStateOf(false) }
        TextButton(onClick = { expanded = !expanded }) {
          Text(state.orgs.firstOrNull { it.id == state.selectedOrgId }?.name ?: stringResource(R.string.select_org))
        }
        if (expanded) {
          Card {
            Column(modifier = Modifier.padding(8.dp)) {
              state.orgs.forEach { org ->
                TextButton(onClick = {
                  expanded = false
                  onSelectOrg(org.id)
                }) {
                  Text(org.name)
                }
              }
            }
          }
        }
        Spacer(modifier = Modifier.weight(1f))
        Text(text = state.wsStatus, style = MaterialTheme.typography.labelSmall)
      }

      Spacer(modifier = Modifier.height(8.dp))
      SessionCreationSection(
        state = state,
        onCreateSession = onCreateSession,
        onCreateModel = onCreateModel,
        onCreateInstructions = onCreateInstructions,
        onCreateSystem = onCreateSystem,
      )

      Spacer(modifier = Modifier.height(8.dp))
      Row {
        Button(onClick = onRefreshSessions) { Text(stringResource(R.string.refresh_sessions)) }
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = stringResource(R.string.commands_hint), style = MaterialTheme.typography.labelSmall)
      }

      Spacer(modifier = Modifier.height(8.dp))
      Text(text = stringResource(R.string.sessions_title), style = MaterialTheme.typography.titleMedium)
      LazyColumn(modifier = Modifier.height(140.dp)) {
        items(state.sessions, key = { it.id }) { session ->
          TextButton(onClick = { onOpenSession(session) }, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.fillMaxWidth()) {
              Text(text = if (session.title.isBlank()) session.id else session.title)
              Text(text = "${session.engineId} · ${session.status}", style = MaterialTheme.typography.labelSmall)
            }
          }
        }
      }

      Spacer(modifier = Modifier.height(8.dp))
      Text(text = stringResource(R.string.terminal_title), style = MaterialTheme.typography.titleMedium)
      Box(
        modifier = Modifier
          .height(220.dp)
          .fillMaxWidth()
          .background(color = Color(0xFF0E1116), shape = RoundedCornerShape(10.dp))
          .padding(10.dp)
      ) {
        LazyColumn {
          items(state.terminalLines, key = { it.key }) { line ->
            when (line) {
              is TerminalLine.SessionEventLine -> {
                Text(
                  text = "#${line.seq} ${line.eventType} [${line.level}]",
                  color = Color(0xFF89DDFF),
                  fontFamily = FontFamily.Monospace,
                )
              }

              is TerminalLine.StreamEventLine -> {
                val text = line.text?.takeIf { it.isNotBlank() } ?: line.kind
                Text(
                  text = "${line.requestId}:${line.streamSeq} ${line.kind} [${line.level}] $text",
                  color = if (line.level == "error") Color(0xFFFF6B6B) else Color(0xFFC3E88D),
                  fontFamily = FontFamily.Monospace,
                )
              }
            }
          }
        }
      }
    }

    Spacer(modifier = Modifier.height(8.dp))
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .imePadding(),
      verticalAlignment = Alignment.CenterVertically
    ) {
      OutlinedTextField(
        value = state.input,
        onValueChange = onInput,
        modifier = Modifier.weight(1f),
        label = { Text(stringResource(R.string.command_input)) },
        enabled = canSend,
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { onSend() }),
      )
      Spacer(modifier = Modifier.width(8.dp))
      Button(onClick = onSend, enabled = canSend) { Text(stringResource(R.string.send_action)) }
    }
  }
}

@Composable
private fun SessionCreationSection(
  state: MobileUiState,
  onCreateSession: (String) -> Unit,
  onCreateModel: (String) -> Unit,
  onCreateInstructions: (String) -> Unit,
  onCreateSystem: (String) -> Unit,
) {
  Column {
    Text(text = stringResource(R.string.create_session_title), style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(
      value = state.createModel,
      onValueChange = onCreateModel,
      label = { Text(stringResource(R.string.model_label)) },
      modifier = Modifier.fillMaxWidth(),
    )
    Spacer(modifier = Modifier.height(6.dp))
    OutlinedTextField(
      value = state.createInstructions,
      onValueChange = onCreateInstructions,
      label = { Text(stringResource(R.string.instructions_label)) },
      modifier = Modifier.fillMaxWidth(),
    )
    Spacer(modifier = Modifier.height(6.dp))
    OutlinedTextField(
      value = state.createSystem,
      onValueChange = onCreateSystem,
      label = { Text(stringResource(R.string.system_label)) },
      modifier = Modifier.fillMaxWidth(),
    )
    Spacer(modifier = Modifier.height(6.dp))
    Row {
      Button(onClick = { onCreateSession("gateway.codex.v2") }) { Text("Codex") }
      Spacer(modifier = Modifier.width(8.dp))
      Button(onClick = { onCreateSession("gateway.claude.v2") }) { Text("Claude") }
      Spacer(modifier = Modifier.width(8.dp))
      Button(onClick = { onCreateSession("gateway.opencode.v2") }) { Text("OpenCode") }
    }
  }
}
