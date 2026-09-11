local mp = require "mp"
local options = require "mp.options"
local utils = require "mp.utils"

local opts = {
    enabled = true,
    width = 320,
    min_width = 240,
    max_width_ratio = 0.58,
    resize_handle_width = 10,
    header_height = 58,
    footer_height = 34,
    row_height = 38,
    font_size = 20,
    font = "auto",
    scroll_rows = 3,
    auto_hide_single = true,
    hide_fullscreen = true,
    title = "播放列表",
}

options.read_options(opts, "playlist_sidebar")

local function resolve_font()
    if opts.font and opts.font ~= "" and opts.font ~= "auto" then
        return opts.font
    end
    local platform = mp.get_property("platform") or ""
    if platform == "windows" then
        return "Microsoft YaHei UI"
    elseif platform == "darwin" then
        return "PingFang SC"
    end
    return "Noto Sans CJK SC"
end

local sidebar_font = resolve_font():gsub("[\\{}]", "")

local section = "javboss-playlist-sidebar"
local width_property = "user-data/javboss/playlist-sidebar-width"
local overlay = mp.create_osd_overlay("ass-events")
local base_margin_right = mp.get_property_number("video-margin-ratio-right", 0) or 0
local visible_start = 1
local visible_rows = 0
local last_playlist_pos = -1
local render_pending = false
local sidebar_visible = false
local current_width = opts.width
local pane_left = 0
local window_width = 0
local window_height = 0
local scale_x = 1
local scale_y = 1
local dragging = false
local click_armed = false
local handle_hovered = false
local handle_mouse_y = nil

local function clamp(value, minimum, maximum)
    return math.max(minimum, math.min(maximum, value))
end

local function get_mouse_position()
    local x, y = mp.get_mouse_pos()
    return x and math.floor(x / scale_x), y and math.floor(y / scale_y)
end

local function ass_escape(value)
    local text = tostring(value or "")
    text = text:gsub("\\", "\\\\")
    text = text:gsub("{", "\\{")
    text = text:gsub("}", "\\}")
    text = text:gsub("[\r\n]+", " ")
    return text
end

local function entry_label(entry)
    local titles = mp.get_property_native("user-data/javboss/playlist-titles", {})
    local label = titles[tostring(entry.id)] or entry.title
    if not label or label == "" then
        label = entry.filename or ""
        if not label:find("://", 1, true) then
            local _, filename = utils.split_path(label)
            if filename and filename ~= "" then
                label = filename
            end
        end
    end
    return ass_escape(label)
end

local function set_margin(value)
    local current = mp.get_property_number("video-margin-ratio-right", base_margin_right) or base_margin_right
    if math.abs(current - value) > 0.0001 then
        mp.set_property_number("video-margin-ratio-right", value)
    end
end

local function publish_width(value)
    local current = mp.get_property_number(width_property, 0) or 0
    if math.abs(current - value) > 0.5 then
        mp.set_property_number(width_property, value)
    end
end

local function hide_sidebar()
    if sidebar_visible then
        overlay:remove()
        mp.disable_key_bindings(section)
        mp.set_mouse_area(0, 0, 0, 0, section)
        sidebar_visible = false
    end
    handle_hovered = false
    handle_mouse_y = nil
    publish_width(0)
    set_margin(base_margin_right)
end

local function playlist_position(playlist)
    local property_pos = mp.get_property_number("playlist-pos", -1) or -1
    if property_pos >= 0 then
        return property_pos + 1
    end
    for index, entry in ipairs(playlist) do
        if entry.playing or entry.current then
            return index
        end
    end
    return 1
end

local function panel_width(window_width)
    local maximum = math.max(1, math.floor(window_width * opts.max_width_ratio))
    return math.max(1, math.min(current_width, maximum))
end

local function update_interaction_area(width, height, expanded)
    local pixel_width = math.floor(width * scale_x + 0.5)
    local pixel_height = math.floor(height * scale_y + 0.5)
    if expanded then
        mp.set_mouse_area(0, 0, pixel_width, pixel_height, section)
    else
        local left = math.max(0, pane_left - math.floor(opts.resize_handle_width / 2))
        mp.set_mouse_area(math.floor(left * scale_x), 0, pixel_width, pixel_height, section)
    end
end

local function append_rect(parts, x1, y1, x2, y2, color, alpha)
    parts[#parts + 1] = string.format(
        "{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H%s&\\1a&H%s&\\p1}m %d %d l %d %d %d %d %d %d{\\p0}",
        color,
        alpha,
        x1,
        y1,
        x2,
        y1,
        x2,
        y2,
        x1,
        y2
    )
end

local function ensure_current_visible(current, count)
    local max_start = math.max(1, count - visible_rows + 1)
    visible_start = clamp(visible_start, 1, max_start)
    if current < visible_start then
        visible_start = current
    elseif current >= visible_start + visible_rows then
        visible_start = current - visible_rows + 1
    end
    visible_start = clamp(visible_start, 1, max_start)
end

local function render()
    render_pending = false
    if not opts.enabled then
        hide_sidebar()
        return
    end

    local playlist = mp.get_property_native("playlist", {}) or {}
    local count = #playlist
    local fullscreen = mp.get_property_native("fullscreen", false)
    local pixel_width, pixel_height = mp.get_osd_size()
    if not pixel_width or not pixel_height or pixel_width < 1 or pixel_height < 1
        or (opts.auto_hide_single and count <= 1)
        or (opts.hide_fullscreen and fullscreen) then
        hide_sidebar()
        return
    end

    local dpi_scale = mp.get_property_number("display-hidpi-scale", 1)
    if not dpi_scale or dpi_scale ~= dpi_scale or dpi_scale <= 0 or dpi_scale == math.huge then
        dpi_scale = 1
    end
    -- ASS uses logical pixels; mpv mouse areas and the ModernZ width use render pixels.
    -- Derive each axis from the rounded canvas to keep fractional DPI scales aligned.
    local width = math.max(1, math.floor(pixel_width / dpi_scale + 0.5))
    local height = math.max(1, math.floor(pixel_height / dpi_scale + 0.5))
    local next_scale_x, next_scale_y = pixel_width / width, pixel_height / height
    if width ~= window_width or height ~= window_height or next_scale_x ~= scale_x or next_scale_y ~= scale_y then
        dragging = false
        click_armed = false
        handle_hovered = false
        handle_mouse_y = nil
    end
    scale_x, scale_y = next_scale_x, next_scale_y
    local pane_width = panel_width(width)
    pane_left = width - pane_width
    window_width = width
    window_height = height
    local previous_visible_rows = visible_rows
    visible_rows = math.max(1, math.floor((height - opts.header_height - opts.footer_height) / opts.row_height))
    local current = playlist_position(playlist)
    if current ~= last_playlist_pos or visible_rows ~= previous_visible_rows then
        ensure_current_visible(current, count)
        last_playlist_pos = current
    else
        visible_start = clamp(visible_start, 1, math.max(1, count - visible_rows + 1))
    end

    set_margin(math.min(0.9, base_margin_right + pane_width / width))
    publish_width(pane_width * scale_x)

    local parts = {}
    append_rect(parts, pane_left, 0, width, height, "17191F", "08")
    append_rect(parts, pane_left, opts.header_height - 1, width, opts.header_height, "424650", "00")
    parts[#parts + 1] = string.format(
        "{\\an4\\pos(%d,%d)\\bord0\\shad0\\fs25\\b1\\fsp0\\fn%s\\1c&HFFFFFF&}%s",
        pane_left + 18,
        math.floor(opts.header_height / 2),
        sidebar_font,
        ass_escape(opts.title)
    )
    parts[#parts + 1] = string.format(
        "{\\an6\\pos(%d,%d)\\bord0\\shad0\\fs16\\b0\\fsp0\\fn%s\\1c&HAAAEB8&}%d / %d",
        width - 16,
        math.floor(opts.header_height / 2),
        sidebar_font,
        current,
        count
    )

    local last_visible = math.min(count, visible_start + visible_rows - 1)
    for index = visible_start, last_visible do
        local entry = playlist[index]
        local row = index - visible_start
        local top = opts.header_height + row * opts.row_height
        local text_y = top + math.floor(opts.row_height / 2)
        local is_current = index == current
        if is_current then
            append_rect(parts, pane_left + 8, top + 2, width - 8, top + opts.row_height - 2, "49331E", "00")
            append_rect(parts, pane_left + 8, top + 2, pane_left + 12, top + opts.row_height - 2, "F0A34A", "00")
        elseif row % 2 == 1 then
            append_rect(parts, pane_left + 8, top + 2, width - 8, top + opts.row_height - 2, "20232A", "30")
        end
        parts[#parts + 1] = string.format(
            "{\\an4\\pos(%d,%d)\\bord0\\shad0\\fs15\\b0\\fsp0\\fn%s\\1c&H%s&}%02d",
            pane_left + 18,
            text_y,
            sidebar_font,
            is_current and "F0A34A" or "858A94",
            index
        )
        parts[#parts + 1] = string.format(
            "{\\an4\\pos(%d,%d)\\clip(%d,%d,%d,%d)\\bord0\\shad0\\fs%d\\b%d\\fsp0\\fn%s\\1c&H%s&}%s",
            pane_left + 52,
            text_y,
            pane_left + 14,
            top,
            width - 12,
            top + opts.row_height,
            opts.font_size,
            is_current and 1 or 0,
            sidebar_font,
            is_current and "FFFFFF" or "CDD0D7",
            entry_label(entry)
        )
    end

    append_rect(parts, pane_left, height - opts.footer_height, width, height, "111319", "10")
    local handle_active = dragging or handle_hovered
    append_rect(
        parts,
        pane_left,
        0,
        pane_left + (handle_active and 4 or 2),
        height,
        handle_active and "F0A34A" or "555A65",
        "00"
    )
    if handle_active then
        local handle_y = clamp(handle_mouse_y or math.floor(height / 2), 24, height - 24)
        append_rect(parts, pane_left - 13, handle_y - 20, pane_left + 15, handle_y + 20, "272A32", "00")
        parts[#parts + 1] = string.format(
            "{\\an5\\pos(%d,%d)\\bord0\\shad0\\fs23\\b1\\fn%s\\1c&HF0A34A&}↔",
            pane_left + 1,
            handle_y,
            sidebar_font
        )
    end
    parts[#parts + 1] = string.format(
        "{\\an5\\pos(%d,%d)\\clip(%d,%d,%d,%d)\\bord0\\shad0\\fs14\\b0\\fsp0\\fn%s\\1c&H9297A2&}拖动左边缘调宽 · 滚轮浏览 · 点击播放",
        pane_left + math.floor(pane_width / 2),
        height - math.floor(opts.footer_height / 2),
        pane_left + 6,
        height - opts.footer_height,
        width - 6,
        height,
        sidebar_font
    )

    overlay.res_x = width
    overlay.res_y = height
    overlay.z = 80
    -- Each positioned element must be its own ASS event. In one event libass
    -- only honors a single position, which collapses the labels and rows.
    overlay.data = table.concat(parts, "\n")
    overlay:update()
    update_interaction_area(width, height, dragging or handle_hovered)
    mp.enable_key_bindings(section, "allow-hide-cursor")
    sidebar_visible = true
end

local function request_render()
    if render_pending then
        return
    end
    render_pending = true
    mp.add_timeout(0.01, render)
end

local function scroll(direction)
    if not sidebar_visible then
        return
    end
    local playlist = mp.get_property_native("playlist", {}) or {}
    local max_start = math.max(1, #playlist - visible_rows + 1)
    visible_start = clamp(visible_start + direction * opts.scroll_rows, 1, max_start)
    request_render()
end

local function play_clicked_row()
    if not sidebar_visible then
        return
    end
    local _, mouse_y = get_mouse_position()
    if not mouse_y or mouse_y < opts.header_height then
        return
    end
    local row = math.floor((mouse_y - opts.header_height) / opts.row_height)
    if row < 0 or row >= visible_rows then
        return
    end
    local index = visible_start + row
    local playlist = mp.get_property_native("playlist", {}) or {}
    if index >= 1 and index <= #playlist then
        mp.commandv("playlist-play-index", index - 1)
    end
end

local function begin_click()
    if not sidebar_visible then
        return
    end
    local mouse_x, mouse_y = get_mouse_position()
    if mouse_x and math.abs(mouse_x - pane_left) <= opts.resize_handle_width then
        dragging = true
        handle_hovered = true
        handle_mouse_y = mouse_y
        click_armed = false
        update_interaction_area(window_width, window_height, true)
        request_render()
        return
    end
    if not mouse_x or mouse_x < pane_left then
        click_armed = false
        return
    end
    click_armed = true
end

local function end_click()
    if dragging then
        dragging = false
        click_armed = false
        request_render()
        return
    end
    if click_armed then
        click_armed = false
        play_clicked_row()
    end
end

local function resize_from_mouse()
    if not dragging then
        return
    end
    local mouse_x = select(1, get_mouse_position())
    if not mouse_x or window_width <= 0 then
        return
    end
    local maximum = math.max(1, math.floor(window_width * opts.max_width_ratio))
    local minimum = math.min(opts.min_width, maximum)
    local next_width = clamp(window_width - mouse_x, minimum, maximum)
    if math.abs(next_width - current_width) >= 1 then
        current_width = next_width
        request_render()
    end
end

local function cancel_drag()
    local was_active = dragging or handle_hovered
    handle_hovered = false
    handle_mouse_y = nil
    if dragging then
        dragging = false
        click_armed = false
    end
    update_interaction_area(window_width, window_height, false)
    if was_active then
        request_render()
    end
end

local function handle_mouse_move()
    local mouse_x, mouse_y = get_mouse_position()
    if dragging then
        handle_mouse_y = mouse_y
        resize_from_mouse()
        return
    end
    local hovered = mouse_x ~= nil and math.abs(mouse_x - pane_left) <= opts.resize_handle_width
    local changed = hovered ~= handle_hovered
    local moved = hovered and mouse_y and (not handle_mouse_y or math.abs(mouse_y - handle_mouse_y) >= 2)
    if changed or moved then
        handle_hovered = hovered
        handle_mouse_y = hovered and mouse_y or nil
        if changed then
            update_interaction_area(window_width, window_height, hovered)
        end
        request_render()
    end
end

-- save-position-on-quit does not persist progress when mpv advances or jumps
-- between playlist entries. Save while the old file is still loaded so the
-- regular resume-playback option can restore it when that entry is opened again.
local function save_position_before_unload()
    if not mp.get_property_native("options/save-position-on-quit", false) then
        return
    end
    if mp.get_property_native("eof-reached", false) then
        return
    end
    if not mp.get_property("path") then
        return
    end
    mp.commandv("write-watch-later-config")
end

mp.set_key_bindings({
    {"mbtn_left", end_click, begin_click},
    {"mouse_move", handle_mouse_move},
    {"mouse_leave", cancel_drag},
    {"wheel_up", function() scroll(-1) end},
    {"wheel_down", function() scroll(1) end},
}, section, "force")
mp.disable_key_bindings(section)

for _, property in ipairs({"playlist", "playlist-pos", "fullscreen", "osd-dimensions", "display-hidpi-scale", "user-data/javboss/playlist-titles"}) do
    mp.observe_property(property, "native", request_render)
end

mp.add_hook("on_unload", 50, save_position_before_unload)
mp.register_event("file-loaded", request_render)
mp.register_event("shutdown", function()
    hide_sidebar()
    overlay:remove()
end)

request_render()
