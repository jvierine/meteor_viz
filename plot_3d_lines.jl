using GLMakie
using HDF5
using ProgressMeter

input_path = isempty(ARGS) ? joinpath(@__DIR__, "data", "maarsy_dataset.h5") : ARGS[1]

## Load the data
hid = h5open(input_path, "r")

# cap the velocity values
vel = read(hid["vels"])
vel[vel .> 70000] .= 70000
vel[vel .< 10000] .= 10000

# initialize arrays
n_events = length(keys(hid["events"]))
n_t = length(read(hid["events/0/orbit"])[1:100:end, 1])
lines_data = fill(NaN, (n_events * (n_t + 1), 3))
lines_color = fill(NaN, n_events * (n_t + 1))
# load the data and concatenate them to create only one line object
@showprogress for (i, i_event) in enumerate(keys(hid["events"]))
    string_dataset = "events/" * i_event * "/orbit"
    meteor_number = parse(Int, i_event) + 1
    data = read(hid[string_dataset])
    lines_data[(1:n_t) .+ 1 .+ (i - 1) * (n_t + 1), :] .= data[1:100:end, 1:3]
    lines_color[(1:n_t) .+ 1 .+ (i - 1) * (n_t + 1)] .= repeat([vel[meteor_number]], n_t)
end

# lines_data[lines_data .> 1500e9] .= NaN
# lines_data[lines_data .< -1500e9] .= NaN
# lines_data[lines_color .> 38000, :] .= NaN
# lines_data[lines_color .< 32000, :] .= NaN
close(hid)

## Plot the data
set_theme!(theme_black())

f = Figure()
ax = Axis3(f[1, 1])
lines!(ax, lines_data; color = lines_color, alpha = 0.1, colorrange = (10000, 70000), colormap=:turbo, overdraw=true)
xlims!(-10 * 150e9, 10 * 150e9)
ylims!(-10 * 150e9, 10 * 150e9)
zlims!(-10 * 150e9, 10 * 150e9)
Colorbar(f[1, 2], colorrange = (10000, 70000), colormap=:turbo)
display(f)

set_theme!()
