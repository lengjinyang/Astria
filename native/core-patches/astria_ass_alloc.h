/* SPDX-License-Identifier: LGPL-2.1-or-later
 * The bundled MinGW libass uses msvcrt, while mpv uses UCRT. Public ASS
 * style/event strings are owned and freed by libass: use its allocator on
 * both sides of that boundary. Keep this in sync with the bundled runtime.
 */
#ifndef ASTRIA_ASS_ALLOC_H
#define ASTRIA_ASS_ALLOC_H
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
static inline FARPROC astria_ass_crt(const char *name)
{
    HMODULE crt = GetModuleHandleW(L"msvcrt.dll");
    FARPROC proc = crt ? GetProcAddress(crt, name) : NULL;
    if (!proc) abort();
    return proc;
}
static inline void *astria_ass_malloc(size_t size)
{
    return ((void *(__cdecl *)(size_t))astria_ass_crt("malloc"))(size);
}
static inline void astria_ass_free(void *ptr)
{
    ((void (__cdecl *)(void *))astria_ass_crt("free"))(ptr);
}
static inline char *astria_ass_strdup(const char *text)
{
    return ((char *(__cdecl *)(const char *))astria_ass_crt("_strdup"))(text);
}
#else
#define astria_ass_malloc malloc
#define astria_ass_free free
#define astria_ass_strdup strdup
#endif
#endif
