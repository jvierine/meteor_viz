
using GLMakie
using HDF5
using ProgressMeter

function plotfun(input_path = joinpath(@__DIR__, "data", "maarsy_dataset.h5"))

    fly_with_earth=false
    
    ## Load the data
    hid = h5open(input_path, "r")
    # Load velocities
    velocity = read(hid["vels"])
    velocity[velocity .> 70000] .= 70000 # clip the high velocities
    velocity[velocity .< 10000] .= 10000 # clip the low velocities
    # Load event keys
    event_keys = parse.(Int, keys(hid["events"]))
    # Load the planets
    massive_states = read(hid["long_term_massive_states"]) ./ 150e9
    # Load the meteors
    # Here we load the meteor data and concatenate everything in only one line object
    n_events = length(keys(hid["events"]))
    n_t = size(read(hid["events/0/orbit"]), 1)
    lines_data = fill(NaN, (n_events * (n_t + 1), 3))
    @showprogress for (i, i_event) in enumerate(keys(hid["events"]))
        string_dataset = "events/" * i_event * "/orbit"
        data = read(hid[string_dataset])
        # I know this is a weird indexing. It is because we want a NaN buffer between each
        # meteor data, so we need to take 2:(n_t + 1) and then use a jump of (n_t + 1)
        # between each meteor
        lines_data[(2:(n_t + 1)) .+ (i - 1) * (n_t + 1), :] .= data[1:end, 1:3] ./ 150e9
    end
    # Close file
    close(hid)


    ## Prepare the animation
    # origin = fill(0.0, (3))
    set_theme!(theme_black())
    fig = Figure()
    ticks_AU_format(val) = map(v -> string(round(Int, v)) * " AU", val)
    max_au = 5 # TODO: use as function argument
    # Implementation with Axis3 (no zoom possible)
    # ax = Axis3(fig[1, 1], perspectiveness = 0.4, xtickformat = ticks_AU_format,
    #            ytickformat = ticks_AU_format, ztickformat = ticks_AU_format)
    # xlims!(-max_au, max_au)
    # ylims!(-max_au, max_au)
    # zlims!(-max_au, max_au)
    # Implementation with LScene (possible to fly through the data)
    ax = LScene(fig[1, 1])
    cc = Makie.Camera3D(ax.scene, projectiontype = Makie.Perspective,
                        eyeposition = Vec3f(30, 30, 10), lookat = Vec3f(0), center = false)
    #=
    DISCLAIMER:
    What follows is a VERY strange syntax that I have never seen in Makie.
    From what I understand we are putting our hands directly in some kind of internals, as
    these things are not possible to modify with the public API (yet).
    =#
    axis = ax.scene[OldAxis]
    # axis[:ticks, :ranges] = (-max_au:max_au, -max_au:max_au, -max_au:max_au)
    axis[:ticks, :formatter] = ticks_AU_format

    # Add button to recenter the camera
    fig[2, 1] = buttongrid = GridLayout(tellwidth = false)
    button_center_cam = buttongrid[1, 1] = Button(fig, label = "Reset camera", labelcolor = :black)
    on(button_center_cam.clicks) do _
        update_cam!(ax.scene, Vec3f(30, 30, 10), Vec3f(0))
    end
    button_center_view = buttongrid[1, 2] = Button(fig, label = "Center view", labelcolor = :black)
    on(button_center_view.clicks) do _
        cc.lookat[] = Vec3f(0)
        update_cam!(ax.scene)
    end

    display(fig)
    set_theme!() # reset the theme


    # Draw the planets orbits
    n_planets = size(massive_states, 1)
    for planet_i in 1:n_planets
        lines!(massive_states[planet_i, 1:10:end, 1:3], color = :white, alpha = 0.1)
    end
    # Plot the planets
    planet_positions = Observable(fill(NaN, (n_planets, 3)))
    scatter!(planet_positions, color = :white, overdraw = true)
    # Plot the meteors
    meteor_pos = [] # to store the meteor positions
    meteor_idx = [] # to store the indices for each meteor
    linelist = [] # to store the lines for each meteor
    n_meteors2plot = 1000 # number of meteors to animate
    for i in 1:n_meteors2plot
        push!(meteor_pos, Observable(Point3f[]))
        push!(meteor_idx, rand(1:n_events)) # randomize the meteors to be animated
        l = lines!(meteor_pos[i], color = velocity[event_keys[meteor_idx[i]] + 1],
                   colorrange = (10e3, 70e3), colormap = :turbo, transparency = true,
                   alpha = 0.2, linewidth = 2)
        push!(linelist, l)
    end



    ## Animate
    trajectory_length = 25 # how long the individual meteor orbit "traces" should be
    time_steps = 5 # size of the time jumps in the animation
    while true
        println("entering draw loop")
        isopen(fig.scene) || break # exit if window is closed
        for i_t in n_t:(-time_steps):1
            isopen(fig.scene) || break  # exit if window is closed
            # Animate the planets
            planet_positions[] = massive_states[1:n_planets, i_t, 1:3]

            if fly_with_earth == true
                cc.eyeposition[] = massive_states[4,i_t,1:3]
                # look at where we are going.
                cc.lookat[] = massive_states[4,(i_t-2)%n_t,1:3]
                update_cam!(ax.scene)
            end

            # Animate the meteors
            for i in 1:n_meteors2plot
                # Again some peculiar indexing. This is because we have those NaN buffers in
                # between each meteor position data vector. So we need to have a (+1) to
                # everything and jumps of size (n_t + 1).
                push!(meteor_pos[i][],
                      lines_data[1 + (meteor_idx[i] - 1) * (n_t + 1) + i_t, :])
                notify(meteor_pos[i])
                # When the length of the orbit "trace" gets too long, erase the oldest points
                if length(meteor_pos[i][]) > trajectory_length
                    popfirst!(meteor_pos[i][])
                end
            end
            sleep(0.0000001)
        end

        # Erase the old meteor position values. This is to avoid the weird "splashing" effect
        # at the beginning of the new animation when meteor_pos contains values from the
        # beginning and the end of the orbit.
        for i in 1:n_meteors2plot
            meteor_pos[i][] = Float64[]
        end

        #         println("randomizing new meteors")
        #         for i = 1:n_meteors2plot
        #             meteor_pos[i].val=Point3f[]

        #             notify(meteor_pos[i])
        #         end

        #         # randomize events to plot
        #         for i = 1:n_meteors2plot
        #             meteor_idx[i]=Int(round(rand()*n_events+1))
        #             linelist[i]= lines!(meteor_pos[i], color = velocity[meteor_idx[i]+1], colorrange=(10e3,70e3), colormap=:turbo, transparency = true, alpha=0.2)
        #         end
        # #        colors.val=Int[]
        #  #       notify(colors)
    end
end



plotfun(isempty(ARGS) ? joinpath(@__DIR__, "data", "maarsy_dataset.h5") : ARGS[1])
