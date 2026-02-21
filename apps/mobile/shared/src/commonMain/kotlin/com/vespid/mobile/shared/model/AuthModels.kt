package com.vespid.mobile.shared.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
  val email: String,
  val password: String,
)

@Serializable
data class UserProfile(
  val id: String,
  val email: String,
  @SerialName("displayName") val displayName: String? = null,
)

@Serializable
data class AuthSession(
  val token: String,
  @SerialName("expiresAt") val expiresAt: Long,
)

@Serializable
data class LoginResponse(
  val session: AuthSession,
  val user: UserProfile,
)

@Serializable
data class MeOrg(
  val id: String,
  val name: String,
  val slug: String? = null,
  @SerialName("roleKey") val roleKey: String? = null,
)

@Serializable
data class Organization(
  val id: String,
  val name: String,
)

@Serializable
data class MeResponse(
  val user: UserProfile,
  val orgs: List<MeOrg>,
  @SerialName("defaultOrgId") val defaultOrgId: String? = null,
)
