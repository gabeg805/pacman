#!/bin/bash
# ******************************************************************************
# 
# Name:    pac
# Author:  Gabriel Gonzalez
# Email:   gabeg@bu.edu
# License: The MIT License (MIT)
# 
# Syntax: pac [option] [confirm]
# 
# Description: Use pacman to determine packages that are ready to be updated. 
#              Display those packages in time order.
# 
# Notes: None.
# 
# ******************************************************************************

# Program information
IFS=$'\n'
ARGV=("$@")
PROG_NAME=`basename $0`
PROG_LOG="/mnt/Linux/Share/scripts/.log/pacInstall.log"
PACMAN_LOG="/var/log/pacman.log"
NETWORK_LOG="/proc/net/wireless"
PACKAGE_LIST=()
PACKAGE_NAMES=()
PACKAGE_DATES=()

# ******************************************************************************
# Package displayer
main()
{
    case "${ARGV[0]}" in
        ''|"-h"|"--help") 
            usage 0
            ;;
        "-u"|"--update") 
            exec_update
            ;;
        "-l"|"--list") 
            exec_list
            ;;
        *)
            usage 1
            ;;
    esac
    exit 0
}

# ******************************************************************************
# Print program usage
usage()
{
    echo "Usage: ${PROG} [option] [confirm]"
    echo
    echo "Options:"
    echo "    -h, --help               Print program usage."
    echo "    -u, --update [confirm]   Display available updates."
    echo
    echo "Confirmation:"
    echo "    -y, --yes                Auto-yes any update question messages."

    if [ "$1" -eq "$1" ] 2> /dev/null; then
        exit "$1"
    else
        exit 1
    fi
}

# ******************************************************************************
# Update packages
exec_update()
{
    network_status
    sync_package_database
    set_package_names
    set_package_dates
    set_package_list
    sort_package_items
    display_packages
    exec_pacman
}

# ******************************************************************************
# Display updateable packages
exec_list()
{
    set_package_names
    set_package_dates
    set_package_list
    sort_package_items
    display_packages
}

# ******************************************************************************
# Execute pacman on all packages
exec_pacman()
{
    blue_font=`tput setaf 4`
    reset_font=`tput sgr0`
    range=(`get_package_index_range`)
    count=0
    for i in "${range[@]}"; do
        dates="${PACKAGE_DATES[${i}]}"
        names="${PACKAGE_NAMES[${i}]}"
        # change to [blue]Name: <package> (#/total#)
        desc=`pacman -Si "${names}" \
                  | grep "Name\|Description" \
                  | sed -e "s/Name   /Package/" -e 's/   //'`
        echo -e "\n${blue_font}${desc}${reset_font}"

        case "${ARGV[1]}" in
            "-y"|"--yes") sudo pacman -S --noconfirm "${names}" ;;
            *)            sudo pacman -S "${names}" ;;
        esac
        if [ $? -eq 0 ]; then
            log_update "${names}" "${dates}"
            count=$[${count} + 1]
        fi
    done

    if [ ${count} -gt 0 ]; then
        sync_man_pages
    fi
}

# ******************************************************************************
# Display packages that need to be updated
display_packages()
{
    und_font=`tput smul`
    no_und_font=`tput rmul`
    n=${#PACKAGE_LIST[@]}
    echo -e "\n${und_font}Package Name\t\t\t\tDate Added to Server${no_und_font}"
    for i in `seq 0 $[${n}-1]`; do
        dates=`date -d "@${PACKAGE_DATES[${i}]}" +%c`
        names="${PACKAGE_NAMES[${i}]}"
        printf "%d: %-30s %s\n" "$[${i}+1]" "${names}" "${dates}"
        PACKAGE_DATES[${i}]="${dates}"
    done
}

# ******************************************************************************
# Sort package items (names, dates, and list)
sort_package_items()
{
    PACKAGE_LIST=(`echo "${PACKAGE_LIST[*]}" | sort`)
    PACKAGE_NAMES=(`echo "${PACKAGE_LIST[*]}" | cut -f2 -d' '`)
    PACKAGE_DATES=(`echo "${PACKAGE_LIST[*]}" | cut -f1 -d' '`)
}

# ******************************************************************************
# Determine the packages that need to be updated
set_package_names()
{
    PACKAGE_NAMES=(`pacman -Qu | cut -f1 -d' '`)
    if [ ${#PACKAGE_NAMES[@]} -eq 0 ]; then
        echo ":: No packages available to update."
        exit 0
    fi
}

# ******************************************************************************
# Determine the date a package was added to the package repository
set_package_dates()
{
    PACKAGE_DATES=(`echo "${PACKAGE_NAMES[@]}" \
                        | xargs pacman -Si \
                        | grep --color=never "Build Date" \
                        | sed -e 's/Build Date[ \t]*: //'`)
    n=${#PACKAGE_DATES[@]}
    if [ ${n} -eq 0 ]; then
        echo ":: No packages available to update."
        exit 0
    else
        for i in `seq 0 $[${n}-1]`; do
            PACKAGE_DATES[${i}]=`date -d "${PACKAGE_DATES[${i}]}" +%s`
        done
    fi
}

# ******************************************************************************
# Piece together the package list
set_package_list()
{
    n=${#PACKAGE_NAMES[@]}
    for i in `seq 0 $[${n}-1]`; do
        dates="${PACKAGE_DATES[${i}]}"
        names="${PACKAGE_NAMES[${i}]}"
        PACKAGE_LIST+=("${dates} ${names}")
    done
}

# ******************************************************************************
# Sync pacman package database
sync_package_database()
{
    echo -n ":: Synchronizing package databases..."
    sudo pacman -Sy 1> /dev/null
    if [ $? -eq 0 ]; then
        echo "Done."
    else
        echo "Fail."
    fi
}

# ******************************************************************************
# Update the man pages
sync_man_pages()
{
    echo -n -e "\n:: Updating man pages..."
    sudo mandb -q   
    echo "Done"
}

# ******************************************************************************
# Prompt user for package indicies to install and return the list
get_package_index_range()
{
    echo                                              1>&2
    echo "Which package(s) would you like to update?" 1>&2
    read -p "?  " input
    local IFS=$', \n'
    for field in `echo "${input}"`; do
        val1=`split_index_range "${field}" 1`
        ret1=$?
        val2=`split_index_range "${field}" 2`
        ret2=$?
        if [ ${ret1} -eq 1 -o ${ret2} -eq 1 ]; then
            echo "${PROG}: No negative indicies allowed." 1>&2
            exit 1
        fi

        get_index_range "${val1}" "${val2}"
    done
}

# ******************************************************************************
# Split a range string based on the specified field
split_index_range()
{
    str="$1"
    field="$2"
    val=
    tracker=-1
    count=1
    for (( i = 0; i < ${#str}; ++i )); do
        char="${str:${i}:1}"
        if [ "${char}" = '-' ]; then
            if [ $[${tracker}+1] -eq ${i} ]; then
                return 1
            fi
            count=$[ ${count} + 1 ]
            tracker=${i}
            continue
        fi

        if [ ${count} -lt ${field} ]; then
            :
        elif [ ${count} -eq ${field} ]; then
            val="${val}${char}"
        else
            break
        fi
    done

    echo "${val}"
}

# ******************************************************************************
# Return the sequential number range from user input
get_index_range()
{
    left="$1"
    right="$2"
    n=${#PACKAGE_NAMES[@]}

    # Check left range value
    flag=0
    if [ -z "${left}" ]; then
        flag=1
    else
        if [ "$(is_index_input "${left}")" = true ]; then
            left=$[ ${left} - 1 ]
        else
            flag=1
        fi
    fi
    if [ ${flag} -eq 1 ]; then
        echo "${PROG}: Invalid index '${left}'." 1>&2
        return 1
    fi

    # Check right range value
    flag=0
    if [ -z "${right}" ]; then
        right=${left}
    else
        if [ "$(is_index_input "${right}")" = true ]; then
            right=$[ ${right} - 1 ]
        else
            flag=1
        fi
    fi
    if [ ${flag} -eq 1 ]; then
        echo "${PROG}: Invalid index '${left}'." 1>&2
        return 1
    fi

    seq "${left}" "${right}"
}

# ******************************************************************************
# Check network connectivity
network_status()
{
    echo -n ":: Verifying network connection..."
    stat=`tail -1 "${NETWORK_LOG}" | grep -c "level"`
    if [ "${stat}" -eq 0 ]; then
        echo "Done."
    else
        echo "Fail."
        echo "${PROG_NAME}: No internet connection detected."
    fi
}

# ******************************************************************************
# Log updated packages
log_update()
{
    names="$1"
    dates="$2"
    upgraded=`is_upgraded "${names}"`
    if $upgraded; then
        echo "Pack Installed: ${names}" >> "${PROG_LOG}"
        echo "Date Uploaded:  ${dates}" >> "${PROG_LOG}"
        echo "Date Installed: $(date)"  >> "${PROG_LOG}"
        echo                            >> "${PROG_LOG}"
    fi
}

# ******************************************************************************
# Checks if package was upgraded
is_upgraded()
{
    
    ## Check log file
    local pack="$1"
    local upgraded=`tail -1 "${PACMAN_LOG}" | grep -c "upgraded ${pack}"` 
    
    ## Return boolean
    if [ ${upgraded} -eq 1 ]; then 
        echo true
    else
        echo false
    fi
}

# ******************************************************************************
# Check if the given user input value is a valid index
is_index_input()
{
    val="$1"
    n=${#PACKAGE_NAMES[@]}
    if [ "${val}" -eq "${val}" ] 2> /dev/null; then
        if [ ${val} -gt 0 -a ${val} -le ${n} ]; then
            echo true
        else
            echo false
        fi
    else
        echo false
    fi
}

# ******************************************************************************
main
